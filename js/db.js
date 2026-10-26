'use strict';
/* KidTasks · слой хранилища (IndexedDB).
   Правило ревизии 4 (R10): каждая операция, меняющая данные, — одна транзакция
   с повторными проверками внутри. Файл не знает про интерфейс. */
window.DB = (function () {
  const NAME = 'kidtasks', VERSION = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = (e) => {
        const db = e.target.result;
        db.createObjectStore('tasks', { keyPath: 'id' });      // задачи родителя (текущая версия + since)
        db.createObjectStore('days', { keyPath: 'date' });     // дневные снимки {date, items:[{taskId,name,points,done}]}
        db.createObjectStore('products', { keyPath: 'id' });   // товары каталога
        db.createObjectStore('cart', { keyPath: 'productId' });// корзина {productId,name,unitPrice,qty}
        db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('settings', { keyPath: 'key' });  // конфиг {key:'config', value:{...}}
        db.createObjectStore('meta', { keyPath: 'key' });      // служебное: lastDay, запрос «что делать?»
      };
      rq.onsuccess = () => { _db = rq.result; resolve(_db); };
      rq.onerror = () => reject(rq.error);
    });
  }

  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function tx(stores, mode) { return _db.transaction(stores, mode); }

  async function get(store, key) { return req(tx([store]).objectStore(store).get(key)); }
  async function put(store, value) { return req(tx([store], 'readwrite').objectStore(store).put(value)); }
  async function del(store, key) { return req(tx([store], 'readwrite').objectStore(store).delete(key)); }
  async function all(store) { return req(tx([store]).objectStore(store).getAll()); }

  /* Атомарная операция: fn(t) синхронно создаёт запросы внутри одной транзакции.
     resolve — после успешного завершения транзакции (R10). */
  function run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = _db.transaction(stores, mode);
      let out;
      try { out = fn(t); } catch (err) { reject(err); return; }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('транзакция прервана'));
    });
  }

  /* Локальная дата YYYY-MM-DD (R3: дата в момент действия). */
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* R3/R9: новый день определяется при открытии приложения.
     Если за сегодня ещё нет снимка — создаём из активных задач (since <= сегодня). */
  function ensureToday() {
    return run(['days', 'tasks', 'meta'], 'readwrite', (t) => {
      const today = todayStr();
      const metaS = t.objectStore('meta'), daysS = t.objectStore('days'), tasksS = t.objectStore('tasks');
      const lastReq = metaS.get('lastDay');
      lastReq.onsuccess = () => {
        if (lastReq.result && lastReq.result.value === today) return;
        const tasksReq = tasksS.getAll();
        tasksReq.onsuccess = () => {
          const items = (tasksReq.result || [])
            .filter((x) => !x.archived && (!x.since || x.since <= today))
            .map((x) => ({ taskId: x.id, name: x.name, points: x.points, done: false }));
          daysS.put({ date: today, items });
          metaS.put({ key: 'lastDay', value: today });
        };
      };
    });
  }

  return { open, get, put, del, all, run, todayStr, ensureToday };
})();
