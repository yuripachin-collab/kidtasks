'use strict';
/* KidTasks · операции над данными. Каждая — одна транзакция с повторными проверками
   внутри (R10). Ошибки: {code, message}. Правки по ревью Codex (docs/06). */
window.Ops = (function () {
  const R = window.Rules, D = window.DB;

  function fail(code, message, extra) {
    const e = new Error(message);
    e.code = code;
    if (extra) Object.assign(e, extra);
    return e;
  }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* Конфигурация хранится как {key:'config', value:{...}} — наружу отдаём value (п.1 ревью). */
  async function balance() { return R.computeBalance(await D.all('history')); }
  async function getConfig() { const rec = await D.get('settings', 'config'); return (rec && rec.value) || null; }
  function saveConfig(value) { return D.put('settings', { key: 'config', value }); }
  /* Атомарное изменение конфигурации: чтение и запись в одной транзакции (п.21 ревью). */
  function updateConfig(mut) {
    return D.run(['settings'], 'readwrite', (tx) => {
      const g = tx.objectStore('settings').get('config');
      g.onsuccess = () => {
        const rec = g.result;
        if (!rec) { tx.abort(); return; }
        mut(rec.value);
        tx.objectStore('settings').put(rec);
      };
    });
  }

  /* --- PIN: PBKDF2 (100k итераций). Префикс алгоритма хранится в хеше;
     при недоступности crypto.subtle используется явный резерв (замечание п.19 —
     на одном устройстве набор API не меняется между сессиями). --- */
  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function hashPin(pin, salt) {
    try {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
      return 'pbkdf2$' + btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(bits))));
    } catch (e1) {
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
      return 'sha256$' + btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(d))));
    }
  }

  /* --- задачи (R2) --- */
  function saveTask(task) {
    const t = R.validateTitle(task.name); if (!t.ok) return Promise.reject(fail('invalid', t.err));
    const p = R.validatePoints(task.points); if (!p.ok) return Promise.reject(fail('invalid', p.err));
    return D.run(['tasks'], 'readwrite', (tx) => {
      const today = D.todayStr(), tomorrow = R.nextDateStr();
      const write = (existing) => {
        // правка задачи с будущей датой — обновляем ту же «завтрашнюю» версию;
        // сегодняшний список защищён снимком дня (создаётся при открытии приложения)
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
  function deleteTask(id) {
    return D.run(['tasks'], 'readwrite', (tx) => { tx.objectStore('tasks').delete(id); });
  }

  /* --- выполнение задач (R1, R5): снятие отметки ОБРАЩАЕТ начисление, а не повторяет его (п.2 ревью) --- */
  function completeTask(date, taskId) {
    return D.run(['days', 'history'], 'readwrite', (tx) => {
      if (date !== D.todayStr()) { tx.abort(); return; } // отметки — только за сегодня (п.9 ревью)
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
          const hq = tx.objectStore('history').getAll();
          hq.onsuccess = () => {
            const bal = R.computeBalance(hq.result || []);
            if (bal - item.points < 0) { tx.abort(); return; } // «сначала убери лишнее из корзины»
            item.done = false;
            tx.objectStore('days').put(day);
            tx.objectStore('history').add({ type: 'back', amount: -item.points, title: 'Снята отметка: ' + item.name, ts: Date.now(), date });
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
        if (day && day.items.length > 0) { tx.abort(); return; } // только при пустом дне
        const mq = tx.objectStore('meta').get('request');
        mq.onsuccess = () => {
          const cur = mq.result && mq.result.value;
          if (cur && !cur.closed) return; // уже активен — сохраняем дату первого (п.13 ревью)
          tx.objectStore('meta').put({ key: 'request', value: { date: today, closed: false } });
        };
      };
    });
  }
  function closeRequest() { return D.put('meta', { key: 'request', value: null }); }
  async function getRequest() { const m = await D.get('meta', 'request'); return (m && m.value) || null; }
  /* Назначить на сегодня: только по активному запросу и с непустым списком (п.13/14 ревью). */
  function assignToday() {
    return D.run(['tasks', 'days', 'meta'], 'readwrite', (tx) => {
      const today = D.todayStr();
      const mq = tx.objectStore('meta').get('request');
      mq.onsuccess = () => {
        const req = mq.result && mq.result.value;
        if (!req || req.closed) { tx.abort(); return; }
        const tq = tx.objectStore('tasks').getAll();
        tq.onsuccess = () => {
          const items = (tq.result || [])
            .filter((x) => !x.archived)
            .map((x) => ({ taskId: x.id, name: x.name, points: x.points, done: false }));
          if (items.length === 0) { tx.abort(); return; } // пусто — запрос остаётся открытым
          const dq = tx.objectStore('days').get(today);
          dq.onsuccess = () => {
            const day = dq.result;
            if (day && day.items.length > 0) { tx.abort(); return; }
            tx.objectStore('days').put({ date: today, items });
            tx.objectStore('meta').put({ key: 'request', value: null });
          };
        };
      };
    });
  }

  /* --- корзина (R6): позиция = товар + снимок цены; смена цены создаёт ОТДЕЛЬНУЮ позицию (п.3 ревью) --- */
  async function cartAdd(productId) {
    const prod = await D.get('products', productId);
    if (!prod) throw fail('not_found', 'Товар не найден');
    const bal = await balance();
    if (bal < prod.price) throw fail('not_enough', 'Не хватает ' + (prod.price - bal) + ' ⭐');
    return D.run(['products', 'cart', 'history'], 'readwrite', (tx) => {
      const pq = tx.objectStore('products').get(productId);
      pq.onsuccess = () => {
        const p2 = pq.result;
        if (!p2 || p2.price !== prod.price) { tx.abort(); return; } // цена изменилась — переоценка
        const hq = tx.objectStore('history').getAll();
        hq.onsuccess = () => {
          const bal2 = R.computeBalance(hq.result || []);
          if (bal2 < p2.price) { tx.abort(); return; }
          const key = productId + '@' + p2.price;
          const cq = tx.objectStore('cart').get(key);
          cq.onsuccess = () => {
            const pos = cq.result;
            if (pos) { pos.qty += 1; tx.objectStore('cart').put(pos); }
            else tx.objectStore('cart').put({ key, productId, name: p2.name, unitPrice: p2.price, qty: 1 });
            tx.objectStore('history').add({ type: 'to_cart', amount: -p2.price, title: 'В корзину: ' + p2.name, ts: Date.now() });
          };
        };
      };
    });
  }
  function cartRemoveUnit(posKey) { // подросток убирает одну штуку
    return D.run(['cart', 'history'], 'readwrite', (tx) => {
      const cq = tx.objectStore('cart').get(posKey);
      cq.onsuccess = () => {
        const pos = cq.result;
        if (!pos) { tx.abort(); return; }
        pos.qty -= 1;
        if (pos.qty <= 0) tx.objectStore('cart').delete(posKey);
        else tx.objectStore('cart').put(pos);
        tx.objectStore('history').add({ type: 'back', amount: pos.unitPrice, title: 'Убрал из корзины: ' + pos.name, ts: Date.now() });
      };
    });
  }
  function cartRemovePosition(posKey) { // родитель убирает позицию целиком
    return D.run(['cart', 'history'], 'readwrite', (tx) => {
      const cq = tx.objectStore('cart').get(posKey);
      cq.onsuccess = () => {
        const pos = cq.result;
        if (!pos) { tx.abort(); return; }
        tx.objectStore('cart').delete(posKey);
        tx.objectStore('history').add({ type: 'back', amount: pos.unitPrice * pos.qty, title: 'Родитель убрал: ' + pos.name + ' ×' + pos.qty, ts: Date.now() });
      };
    });
  }
  function issueCart() { // «Выдано»: справочные записи с нулевым влиянием на баланс
    return D.run(['cart', 'history'], 'readwrite', (tx) => {
      const cq = tx.objectStore('cart').getAll();
      cq.onsuccess = () => {
        const positions = cq.result || [];
        if (positions.length === 0) { tx.abort(); return; }
        const hs = tx.objectStore('history');
        for (const pos of positions) {
          hs.add({ type: 'issued', amount: 0, title: 'Выдано: ' + pos.name + ' ×' + pos.qty + ' (' + pos.unitPrice * pos.qty + ' ⭐)', ts: Date.now() });
          tx.objectStore('cart').delete(pos.key);
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

  /* --- настройки (атомарно, п.21 ревью) --- */
  function changeName(name) {
    const v = R.validateName(name); if (!v.ok) return Promise.reject(fail('invalid', v.err));
    return updateConfig((cfg) => { cfg.childName = v.value; });
  }
  function setTheme(theme) {
    return updateConfig((cfg) => { cfg.theme = theme; });
  }
  async function changePin(currentPin, newPin) {
    const cfg = await getConfig(); if (!cfg) throw fail('no_config', 'Нет конфигурации');
    const cur = await hashPin(currentPin, cfg.pin.salt);
    if (cur !== cfg.pin.hash) throw fail('wrong_pin', 'Текущий PIN неверен');
    const v = R.validatePin(newPin); if (!v.ok) throw fail('invalid', v.err);
    const salt = randomSalt();
    const hash = await hashPin(v.value, salt);
    return updateConfig((c2) => { c2.pin = { salt, hash }; });
  }
  /* п.5 ревью: наружу — value, без обёртки */
  async function getPinLock() { const rec = await D.get('settings', 'pinlock'); return (rec && rec.value) || { fails: 0, until: 0 }; }
  function putPinLock(lock) { return D.put('settings', { key: 'pinlock', value: lock }); }
  /* п.20 ревью: закрываем своё соединение; успех — только onsuccess */
  async function resetAll() {
    D.close();
    await new Promise((resolve, reject) => {
      const rq = indexedDB.deleteDatabase('kidtasks');
      rq.onsuccess = resolve;
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(fail('blocked', 'Закройте другие вкладки приложения и попробуйте снова'));
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
