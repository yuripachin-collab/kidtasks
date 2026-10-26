'use strict';
/* KidTasks · модульные тесты: правила (Rules) и операции (Ops) на fake-indexeddb.
   Запуск: node tests/run-tests.js  (из папки tests, после npm i) */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
require('fake-indexeddb/auto');

global.window = global;
function load(rel) { new Function(fs.readFileSync(path.join(__dirname, '..', 'js', rel), 'utf8'))(); }
load('db.js'); load('rules.js'); load('ops.js');
const D = window.DB, R = window.Rules, Ops = window.Ops;

const today = D.todayStr();
function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const tomorrow = tomorrowStr();

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}
async function throws(fn, code) {
  try { await fn(); return false; }
  catch (e) { return code ? e.code === code : true; }
}

(async function main() {
  console.log('— Правила (Rules) —');
  await test('валидация: имя/PIN/баллы/комментарий', async () => {
    assert.strictEqual(R.validateName('  Юра ').value, 'Юра');
    assert.strictEqual(R.validateName('').ok, false);
    assert.strictEqual(R.validateName('x'.repeat(61)).ok, false);
    assert.strictEqual(R.validatePin('1234').ok, true);
    assert.strictEqual(R.validatePin('12a4').ok, false);
    assert.strictEqual(R.validatePoints(0).ok, false);
    assert.strictEqual(R.validatePoints(1000).ok, false);
    assert.strictEqual(R.validatePoints('7').value, 7);
    assert.strictEqual(R.validateComment('   ').ok, false);
    assert.strictEqual(R.validateComment('х'.repeat(101)).ok, false);
  });
  await test('серия 🔥: полный день растит, пустой — пауза, неполный — рвёт', async () => {
    const mk = (date, done, n) => ({ date, items: Array.from({ length: n }, (_, i) => ({ taskId: 't' + i, done })) });
    const days = [
      mk('2026-10-20', true, 2),   // полный
      mk('2026-10-21', false, 1),  // неполный — должен разорвать
      mk('2026-10-22', true, 1),
      mk('2026-10-23', false, 0)   // пустой — пауза
    ];
    // идём от 2026-10-24: 23 пусто (пауза), 22 полный (+1), 21 неполный (стоп) => 1
    assert.strictEqual(R.streak(days, '2026-10-24'), 1);
    // от 2026-10-23: сегодня пустой (не растит не рвёт), 22 (+1), 21 неполный (стоп) => 1
    assert.strictEqual(R.streak(days, '2026-10-23'), 1);
    // от 2026-10-22: сегодня полный (+1), 21 неполный — уже в прошлом рвёт => 1
    assert.strictEqual(R.streak(days, '2026-10-22'), 1);
    const allDone = [mk('2026-10-20', true, 2), mk('2026-10-21', true, 2), mk('2026-10-22', true, 2)];
    assert.strictEqual(R.streak(allDone, '2026-10-22'), 3);
  });
  await test('история: знак по сумме записи (снятие отметки — минус)', async () => {
    assert.strictEqual(R.historyLabel({ amount: 10, title: 'x' }).sign, 1);
    assert.strictEqual(R.historyLabel({ amount: -10, title: 'Снята отметка' }).sign, -1);
    assert.strictEqual(R.historyLabel({ amount: 0, title: 'Выдано' }).sign, 0);
  });

  console.log('— Операции (Ops) на fake-indexeddb —');
  await test('старт: чистая база открывается', async () => { await D.open(); });
  await test('конфигурация: наружу отдаётся value, а не обёртка (регрессия №1 ревью)', async () => {
    await Ops.saveConfig({ childName: 'Юра', pin: { salt: 'salt', hash: 'hash' }, theme: 'light' });
    const cfg = await Ops.getConfig();
    assert.strictEqual(cfg.childName, 'Юра');
    assert.strictEqual(cfg.pin.salt, 'salt');
  });
  await test('PIN-блокировка: счётчик читается без обёртки (регрессия №5)', async () => {
    await Ops.putPinLock({ fails: 3, until: 0 });
    const lock = await Ops.getPinLock();
    assert.strictEqual(lock.fails, 3);
    assert.strictEqual(lock.until, 0);
  });
  await test('задачи: создаются с датой «завтра»', async () => {
    await Ops.saveTask({ name: 'Вынести мусор', points: 10 });
    await Ops.saveTask({ name: 'Читать 30 минут', points: 10 });
    const tasks = await D.all('tasks');
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].since, tomorrow);
  });
  await test('ensureToday: снимок существует и пуст (задачи — с завтрашнего дня)', async () => {
    await D.ensureToday();
    const day = await D.get('days', today);
    assert.ok(day);
    assert.strictEqual(day.items.length, 0);
  });
  await test('запрос: создаётся только при пустом дне, дубль не перетирает дату', async () => {
    await Ops.setRequest();
    const req = await Ops.getRequest();
    assert.strictEqual(req.date, today);
    await Ops.setRequest();
    assert.strictEqual((await Ops.getRequest()).date, today);
  });
  await test('assignToday: без активного запроса — отказ; без задач — отказ (п.13/14 ревью)', async () => {
    await Ops.closeRequest();
    assert.strictEqual(await throws(() => Ops.assignToday()), true);
    await Ops.setRequest();
    await Ops.deleteTask((await D.all('tasks'))[0].id);
    await Ops.deleteTask((await D.all('tasks'))[0].id);
    assert.strictEqual(await throws(() => Ops.assignToday()), true);
    // вернём задачу и назначим — запрос закроется
    await Ops.saveTask({ name: 'Домашка', points: 15 });
    await Ops.assignToday();
    const day = await D.get('days', today);
    assert.strictEqual(day.items.length, 1);
    assert.strictEqual(await Ops.getRequest(), null);
  });
  await test('отметка: начисляет; снятие — возвращает (регрессия №2)', async () => {
    const day = await D.get('days', today);
    const id = day.items[0].taskId;
    await Ops.completeTask(today, id);
    assert.strictEqual(await Ops.balance(), 15);
    await Ops.completeTask(today, id);
    assert.strictEqual(await Ops.balance(), 0);
    assert.strictEqual((await D.get('days', today)).items[0].done, false);
  });
  await test('снятие отметки при нехватке баланса — отказ (R1/R5)', async () => {
    const day = await D.get('days', today);
    const id = day.items[0].taskId;
    await Ops.completeTask(today, id);           // +15
    await Ops.adjust(-1, 15, 'списали в минус?'); // 0
    assert.strictEqual(await throws(() => Ops.completeTask(today, id)), true);
    assert.strictEqual(await Ops.balance(), 0);
    assert.strictEqual((await D.get('days', today)).items[0].done, true);
    await Ops.adjust(1, 15, 'вернули');          // 15
  });
  await test('прошедшая дата: отметки только за сегодня (п.9 ревью)', async () => {
    assert.strictEqual(await throws(() => Ops.completeTask('2026-01-01', 't1')), true);
  });
  await test('корзина (чистый прогон): покупки, смены цены, возвраты по снимкам', async () => {
    await Ops.resetAll(); await D.open();
    await Ops.saveConfig({ childName: 'Юра', pin: { salt: 's', hash: 'h' }, theme: 'light' });
    await Ops.saveTask({ name: 'Задача А', points: 50 });
    await Ops.setRequest();
    await Ops.assignToday();
    const day = await D.get('days', today);
    await Ops.completeTask(today, day.items[0].taskId); // баланс 50
    await Ops.saveProduct({ name: 'Шоколадка', price: 10 });
    const pid = (await D.all('products'))[0].id;
    await Ops.cartAdd(pid);                              // 40
    await Ops.saveProduct({ id: pid, name: 'Шоколадка', price: 30 });
    await Ops.cartAdd(pid);                              // 10, вторая позиция
    const cart = await D.all('cart');
    assert.strictEqual(cart.length, 2);
    // не хватает на ещё одну по 30
    assert.strictEqual(await throws(() => Ops.cartAdd(pid), 'not_enough'), true);
    // возвраты по снимкам
    const pos30 = cart.find((p) => p.unitPrice === 30);
    const pos10 = cart.find((p) => p.unitPrice === 10);
    await Ops.cartRemoveUnit(pos30.key, false);          // +30 → 40
    assert.strictEqual(await Ops.balance(), 40);
    await Ops.cartRemoveUnit(pos10.key, false);          // +10 → 50
    assert.strictEqual(await Ops.balance(), 50);
    // родитель убирает позицию целиком: добавим на счёт и купим 3 шт по 30
    await Ops.adjust(1, 40, 'начислили для теста позиции'); // 90
    await Ops.cartAdd(pid);                              // 60
    await Ops.cartAdd(pid);                              // 30
    await Ops.cartAdd(pid);                              // 0
    let cart2 = await D.all('cart');
    assert.strictEqual(cart2.length, 1);                 // обе штуки в одной позиции по 30
    assert.strictEqual(cart2[0].qty, 3);
    await Ops.cartRemoveUnit(cart2[0].key, false);       // +30 → 30 (осталось 2)
    cart2 = await D.all('cart');
    assert.strictEqual(cart2[0].qty, 2);
    await Ops.cartRemovePosition(cart2[0].key);          // +60 → 90; позиция исчезла
    assert.strictEqual(await Ops.balance(), 90);
    assert.strictEqual((await D.all('cart')).length, 0);
  });
  await test('выдано: корзина пуста, записи с нулём, баланс не меняется', async () => {
    await Ops.cartAdd((await D.all('products'))[0].id);  // -30 → 60
    const before = await Ops.balance();
    await Ops.issueCart();
    assert.strictEqual((await D.all('cart')).length, 0);
    assert.strictEqual(await Ops.balance(), before);
    const issued = (await D.all('history')).filter((h) => h.type === 'issued');
    assert.ok(issued.length > 0);
    assert.ok(issued.every((h) => h.amount === 0));
  });
  await test('корректировка: списание больше баланса — отказ; комментарий обязателен', async () => {
    assert.strictEqual(await throws(() => Ops.adjust(-1, 999, 'много')), true);
    assert.strictEqual(await throws(() => Ops.adjust(1, 5, '   ')), true);
    await Ops.adjust(1, 5, 'помог собрать рюкзак');
    // после выдачи корзины баланс 60+5=65
    assert.strictEqual(await Ops.balance(), 65);
  });
  await test('ensureToday: идемпотентен, отметки не теряются (регрессия №4)', async () => {
    const day = await D.get('days', today);
    const id = day.items[0].taskId;
    const was = day.items[0].done;
    await Ops.completeTask(today, id);       // переключили
    await D.ensureToday(); await D.ensureToday();
    const day2 = await D.get('days', today);
    assert.strictEqual(day2.items[0].done, !was); // состояние пережило пересоздание дня
    await Ops.completeTask(today, id);       // вернуть как было
  });
  await test('сброс: база удаляется, конфигурация исчезает', async () => {
    await Ops.resetAll(); await D.open();
    assert.strictEqual(await Ops.getConfig(), null);
  });

  console.log('\nИтог: ' + passed + ' прошло, ' + failed + ' упало');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ФАТАЛЬНО:', e); process.exit(2); });
