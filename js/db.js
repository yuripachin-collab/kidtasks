'use strict';
/* KidTasks · слой хранилища (IndexedDB).
   R10: каждая операция, меняющая данные, — одна транзакция с проверками внутри.
   П.15/16 ревью: put/del завершаются только по commit транзакции; исключение в run() прерывает её. */
window.DB = (function () {
  const NAME = 'kidtasks', VERSION = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = (e) => {
        const db = e.target.result;
        // п.35 ревью: миграции — по oldVersion; v1 — начальная схема
        if (e.oldVersion < 1) {
          db.createObjectStore('tasks', { keyPath: 'id' });      // {id,name,points,archived,since}
          db.createObjectStore('days', { keyPath: 'date' });     // снимки {date,items:[{taskId,name,points,done}]}
          db.createObjectStore('products', { keyPath: 'id' });   // {id,name,price,photo}
          db.createObjectStore('cart', { keyPath: 'key' });      // {key: productId@цена, productId, name, unitPrice, qty}
          db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          db.createObjectStore('settings', { keyPath: 'key' });  // {key:'config'|'pinlock', value:{...}}
          db.createObjectStore('meta', { keyPath: 'key' });      // {key:'lastDay'|'request', value:...}
        }
        // пример будущей миграции: if (e.oldVersion < 2) { ... }
      };
      rq.onsuccess = () => {
        _db = rq.result;
        // п.20 ревью: уступаем соединение при удалении базы из другого окна
        _db.onversionchange = () => { _db.close(); _db = null; };
        resolve(_db);
      };
      rq.onerror = () => reject(rq.error);
    });
  }
  function close() { if (_db) { _db.close(); _db = null; } }

  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function tx(stores, mode) { return _db.transaction(stores, mode); }

  async function get(store, key) { return req(tx([store]).objectStore(store).get(key)); }
  async function all(store) { return req(tx([store]).objectStore(store).getAll()); }

  /* Запись/удаление: успех только по завершении транзакции (п.15 ревью). */
  function put(store, value) {
    return run([store], 'readwrite', (t) => { t.objectStore(store).put(value); });
  }
  function del(store, key) {
    return run([store], 'readwrite', (t) => { t.objectStore(store).delete(key); });
  }

  /* Атомарная операция. fn(t) создаёт запросы синхронно; исключение — abort (п.16 ревью). */
  function run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = _db.transaction(stores, mode);
      let out;
      try { out = fn(t); } catch (err) { try { t.abort(); } catch (_) {} reject(err); return; }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('транзакция прервана'));
    });
  }

  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayStr() { return dateStr(new Date()); }

  /* R3/R9: снимок дня создаётся один раз и НИКОГДА не перезаписывается автоматически
     (п.4 ревью: возврат даты устройства не затирает отметки). */
  function ensureToday() {
    return run(['days', 'tasks', 'meta'], 'readwrite', (t) => {
      const today = todayStr();
      const daysS = t.objectStore('days'), metaS = t.objectStore('meta'), tasksS = t.objectStore('tasks');
      const exq = daysS.get(today);
      exq.onsuccess = () => {
        if (!exq.result) {
          const tq = tasksS.getAll();
          tq.onsuccess = () => {
            const items = (tq.result || [])
              .filter((x) => !x.archived && (!x.since || x.since <= today))
              .map((x) => ({ taskId: x.id, name: x.name, points: x.points, done: false }));
            daysS.put({ date: today, items });
          };
        }
        metaS.put({ key: 'lastDay', value: today });
      };
    });
  }

  return { open, close, get, put, del, all, run, todayStr, ensureToday };
})();
