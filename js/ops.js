'use strict';
/* KidTasks · операции над данными. Каждая операция — одна транзакция IndexedDB
   с повторными проверками внутри (R10). Ошибки: {code, message}. */
window.Ops = (function () {
  const R = window.Rules, D = window.DB;

  function fail(code, message, extra) {
    const e = new Error(message);
    e.code = code;
    if (extra) Object.assign(e, extra);
    return e;
  }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  async function balance() { return R.computeBalance(await D.all('history')); }
  async function getConfig() { return (await D.get('settings', 'config')) || null; }
  function saveConfig(value) { return D.put('settings', { key: 'config', value }); }

  /* --- PIN: PBKDF2, при недоступности crypto.subtle — резервные варианты --- */
  function randomSalt() {
    const a = new Uint8Array(16);
    (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.floor(Math.random() * 256));
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function hashPin(pin, salt) {
    try {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
      return 'pbkdf2$' + btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(bits))));
    } catch (e1) {
      try {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
        return 'sha256$' + btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(d))));
      } catch (e2) {
        let h = 5381; const s = salt + ':' + pin;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return 'djb2$' + h;
      }
    }
  }

  /* --- задачи (R2, R9) --- */
  function saveTask(task) {
    const t = R.validateTitle(task.name); if (!t.ok) return Promise.reject(fail('invalid', t.err));
    const p = R.validatePoints(task.points); if (!p.ok) return Promise.reject(fail('invalid', p.err));
    return D.run(['tasks'], 'readwrite', (tx) => {
      const today = D.todayStr(), tomorrow = R.nextDateStr();
      const write = (existing) => {
        // правка задачи с будущей датой — обновляем ту же «завтрашнюю» версию (п.8 ревью)
        let since = tomorrow;
        if (existing && existing.since && existing.since > today) since = existing.since;
        const id = existing ? existing.id : newId('t');
        tx.objectStore('tasks').put({ id, name: t.value, points: p.value, archived: false, since });
      };
      if (task.id) {
        const g = tx.objectStore('tasks').get(task.id);
        g.onsuccess = () => write(g.result);
      } else write(null);
    });
  }
  /* Ответ на запрос «что мне сегодня делать?» (п.6 ревью):
     заполняем ПУСТЫЙ сегодняшний день текущими активными задачами и закрываем запрос. */
  function assignToday() {
    return D.run(['tasks', 'days', 'meta'], 'readwrite', (tx) => {
      const today = D.todayStr();
      const dq = tx.objectStore('days').get(today);
      dq.onsuccess = () => {
        const day = dq.result;
        if (day && day.items.length > 0) { tx.abort(); return; } // день уже заполнен
        const tq = tx.objectStore('tasks').getAll();
        tq.onsuccess = () => {
          const items = (tq.result || [])
            .filter((x) => !x.archived)
            .map((x) => ({ taskId: x.id, name: x.name, points: x.points, done: false }));
          tx.objectStore('days').put({ date: today, items });
          tx.objectStore('meta').put({ key: 'request', value: null });
        };
      };
    });
  }
  function deleteTask(id) {
    return D.run(['tasks'], 'readwrite', (tx) => { tx.objectStore('tasks').delete(id); });
  }

  /* --- выполнение задач (R1, R5) --- */
  function completeTask(date, taskId) {
    return D.run(['days', 'history'], 'readwrite', (tx) => {
      const dq = tx.objectStore('days').get(date);
      dq.onsuccess = () => {
        const day = dq.result;
        const item = day && day.items.find((i) => i.taskId === taskId);
        if (!item) { tx.abort(); return; }
        if (!item.done) {
          item.done = true;
          tx.objectStore('days').put(day);
          tx.objectStore('history').add({ type: 'earn', amount: item.points, title: 'Задача: ' + item.name, ts: Date.now(), date });
        } else {
          // снятие отметки: возврат по компенсирующей записи; минус исключён (R5)
          const hq = tx.objectStore('history').getAll();
          hq.onsuccess = () => {
            const bal = R.computeBalance(hq.result || []);
            if (bal + item.points < 0) { tx.abort(); return; }
            item.done = false;
            tx.objectStore('days').put(day);
            tx.objectStore('history').add({ type: 'back', amount: item.points, title: 'Снята отметка: ' + item.name, ts: Date.now(), date });
          };
        }
      };
    });
  }

  /* --- запрос «что мне сегодня делать?» (R9) --- */
  function setRequest() {
    return D.run(['days', 'meta'], 'readwrite', (tx) => {
      const today = D.todayStr();
      const dq = tx.objectStore('days').get(today);
      dq.onsuccess = () => {
        const day = dq.result;
        if (day && day.items.length > 0) { tx.abort(); return; } // запрос — только при пустом дне
        tx.objectStore('meta').put({ key: 'request', value: { date: today, closed: false } });
      };
    });
  }
  function closeRequest() { return D.put('meta', { key: 'request', value: null }); }
  async function getRequest() { const m = await D.get('meta', 'request'); return (m && m.value) || null; }

  /* --- корзина (R6): снимок цены на момент добавления --- */
  async function cartAdd(productId) {
    const prod = await D.get('products', productId);
    if (!prod) throw fail('not_found', 'Товар не найден');
    const bal = await balance();
    if (bal < prod.price) throw fail('not_enough', 'Не хватает ' + (prod.price - bal) + ' ⭐', { missing: prod.price - bal });
    return D.run(['products', 'cart', 'history'], 'readwrite', (tx) => {
      const pq = tx.objectStore('products').get(productId);
      pq.onsuccess = () => {
        const p2 = pq.result;
        if (!p2 || p2.price !== prod.price) { tx.abort(); return; } // цена изменилась — переоценка
        const hq = tx.objectStore('history').getAll();
        hq.onsuccess = () => {
          const bal2 = R.computeBalance(hq.result || []);
          if (bal2 < p2.price) { tx.abort(); return; }
          const cq = tx.objectStore('cart').get(productId);
          cq.onsuccess = () => {
            const pos = cq.result;
            if (pos) { pos.qty += 1; tx.objectStore('cart').put(pos); }
            else tx.objectStore('cart').put({ productId, name: p2.name, unitPrice: p2.price, qty: 1 });
            tx.objectStore('history').add({ type: 'to_cart', amount: -p2.price, title: 'В корзину: ' + p2.name, ts: Date.now() });
          };
        };
      };
    });
  }
  function cartRemoveUnit(productId, byParent) {
    return D.run(['cart', 'history'], 'readwrite', (tx) => {
      const cq = tx.objectStore('cart').get(productId);
      cq.onsuccess = () => {
        const pos = cq.result;
        if (!pos) { tx.abort(); return; }
        pos.qty -= 1;
        if (pos.qty <= 0) tx.objectStore('cart').delete(productId);
        else tx.objectStore('cart').put(pos);
        tx.objectStore('history').add({
          type: 'back', amount: pos.unitPrice,
          title: (byParent ? 'Родитель убрал (штука): ' : 'Убрал из корзины: ') + pos.name, ts: Date.now()
        });
      };
    });
  }
  function cartRemovePosition(productId) { // родитель убирает позицию целиком (п.13 ревью)
    return D.run(['cart', 'history'], 'readwrite', (tx) => {
      const cq = tx.objectStore('cart').get(productId);
      cq.onsuccess = () => {
        const pos = cq.result;
        if (!pos) { tx.abort(); return; }
        tx.objectStore('cart').delete(productId);
        tx.objectStore('history').add({
          type: 'back', amount: pos.unitPrice * pos.qty,
          title: 'Родитель убрал: ' + pos.name + ' ×' + pos.qty, ts: Date.now()
        });
      };
    });
  }
  function issueCart() { // «Выдано»: справочные записи с нулевым влиянием (п.3 ревью)
    return D.run(['cart', 'history'], 'readwrite', (tx) => {
      const cq = tx.objectStore('cart').getAll();
      cq.onsuccess = () => {
        const positions = cq.result || [];
        if (positions.length === 0) { tx.abort(); return; }
        const hs = tx.objectStore('history');
        for (const pos of positions) {
          hs.add({ type: 'issued', amount: 0, title: 'Выдано: ' + pos.name + ' ×' + pos.qty + ' (' + pos.unitPrice * pos.qty + ' ⭐)', ts: Date.now() });
          tx.objectStore('cart').delete(pos.productId);
        }
      };
    });
  }

  /* --- корректировка родителем (R7) --- */
  async function adjust(sign, amount, comment) {
    const c = R.validateComment(comment); if (!c.ok) throw fail('invalid', c.err);
    const n = R.validatePoints(amount); if (!n.ok) throw fail('invalid', n.err);
    const bal = await balance();
    if (sign < 0 && n.value > bal) throw fail('not_enough', 'Нельзя списать больше, чем есть (' + bal + ' ⭐)');
    return D.run(['history'], 'readwrite', (tx) => {
      const hq = tx.objectStore('history').getAll();
      hq.onsuccess = () => {
        const bal2 = R.computeBalance(hq.result || []);
        if (sign < 0 && n.value > bal2) { tx.abort(); return; }
        tx.objectStore('history').add({
          type: sign > 0 ? 'bonus' : 'deduct', amount: sign > 0 ? n.value : -n.value,
          title: (sign > 0 ? 'Бонус: ' : 'Списано: ') + c.value, ts: Date.now()
        });
      };
    });
  }

  /* --- каталог товаров --- */
  function saveProduct(p) {
    const t = R.validateTitle(p.name); if (!t.ok) return Promise.reject(fail('invalid', t.err));
    const pr = R.validatePoints(p.price); if (!pr.ok) return Promise.reject(fail('invalid', pr.err));
    return D.put('products', { id: p.id || newId('p'), name: t.value, price: pr.value, photo: p.photo || null });
  }
  function deleteProduct(id) { return D.del('products', id); }

  /* --- настройки и PIN (R10 спеки: сессия, блокировка) --- */
  async function changeName(name) {
    const v = R.validateName(name); if (!v.ok) throw fail('invalid', v.err);
    const cfg = await getConfig(); if (!cfg) throw fail('no_config', 'Нет конфигурации');
    cfg.childName = v.value; await saveConfig(cfg);
  }
  async function setTheme(theme) {
    const cfg = await getConfig(); if (!cfg) throw fail('no_config', 'Нет конфигурации');
    cfg.theme = theme; await saveConfig(cfg);
  }
  async function changePin(currentPin, newPin) {
    const cfg = await getConfig(); if (!cfg) throw fail('no_config', 'Нет конфигурации');
    const cur = await hashPin(currentPin, cfg.pin.salt);
    if (cur !== cfg.pin.hash) throw fail('wrong_pin', 'Текущий PIN неверен');
    const v = R.validatePin(newPin); if (!v.ok) throw fail('invalid', v.err);
    const salt = randomSalt();
    cfg.pin = { salt, hash: await hashPin(v.value, salt), algo: 'pbkdf2' };
    await saveConfig(cfg);
  }
  async function getPinLock() { return (await D.get('settings', 'pinlock')) || { fails: 0, until: 0 }; }
  function putPinLock(lock) { return D.put('settings', { key: 'pinlock', value: lock }); }
  async function resetAll() {
    await new Promise((res, rej) => {
      const rq = indexedDB.deleteDatabase('kidtasks');
      rq.onsuccess = res; rq.onerror = () => rej(rq.error); rq.onblocked = res;
    });
  }

  return {
    balance, getConfig, saveConfig, hashPin, randomSalt,
    saveTask, assignToday, deleteTask, completeTask, setRequest, closeRequest, getRequest,
    cartAdd, cartRemoveUnit, cartRemovePosition, issueCart, adjust,
    saveProduct, deleteProduct,
    changeName, setTheme, changePin, getPinLock, putPinLock, resetAll
  };
})();
