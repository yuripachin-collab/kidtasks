'use strict';
/* KidTasks · чистые правила (без хранилища и интерфейса) — легко тестировать.
   Номера R1–R11 соответствуют docs/02-spec.md, ревизия 4. */
window.Rules = (function () {

  /* --- строки и валидация (R11) --- */
  function trim(s) { return String(s == null ? '' : s).replace(/^\s+/, '').replace(/\s+$/, ''); }
  function validateName(s) {
    const v = trim(s);
    if (!v) return { ok: false, err: 'Введите имя' };
    if (v.length > 60) return { ok: false, err: 'Имя — до 60 символов' };
    return { ok: true, value: v };
  }
  function validatePin(p) {
    if (!/^\d{4}$/.test(String(p || ''))) return { ok: false, err: 'PIN — ровно 4 цифры' };
    return { ok: true, value: String(p) };
  }
  function validatePoints(p) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false, err: 'Число — целое от 1 до 999' };
    return { ok: true, value: n };
  }
  function validateTitle(s) {
    const v = trim(s);
    if (!v) return { ok: false, err: 'Введите название' };
    if (v.length > 60) return { ok: false, err: 'Название — до 60 символов' };
    return { ok: true, value: v };
  }
  function validateComment(s) {
    const v = trim(s);
    if (!v) return { ok: false, err: 'Добавьте комментарий' };
    if (v.length > 100) return { ok: false, err: 'Комментарий — до 100 символов' };
    return { ok: true, value: v };
  }

  /* --- баланс и корзина (R5, R6) --- */
  function computeBalance(history) {
    let sum = 0;
    for (const h of history) sum += h.amount;
    return sum;
  }
  function cartTotal(cart) {
    let sum = 0;
    for (const p of cart) sum += p.unitPrice * p.qty;
    return sum;
  }

  /* --- даты (R3): локальная дата в момент действия --- */
  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayStr() { return dateStr(new Date()); }
  function nextDateStr() { const d = new Date(); d.setDate(d.getDate() + 1); return dateStr(d); }

  /* --- день (R4) --- */
  function dayAllDone(day) { return !!day && day.items.length > 0 && day.items.every((i) => i.done); }
  function dayPending(day) { return day ? day.items.filter((i) => !i.done).length : 0; }

  /* Серия 🔥 (R4): идём по снимкам от сегодня назад.
     - сегодня: растит серию, только если выполнено всё; незавершённое сегодня — не рвёт и не растит;
     - прошедшие дни: полный ++, пустой — пауза (пропуск), неполный — разрывает;
     - дни без снимка (приложение не открывали) — пауза; ограничение зафиксировано в спеке §7 (п.11 ревью). */
  function streak(days, today) {
    const sorted = days
      .filter((d) => d.date <= today)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    let s = 0;
    for (const d of sorted) {
      if (d.items.length === 0) continue;
      const complete = d.items.every((i) => i.done);
      if (d.date === today) {
        if (complete) s++;
        continue;
      }
      if (complete) s++;
      else break;
    }
    return s;
  }

  /* Знак движения — по сумме записи: «back» бывает и возвратом (+), и снятием отметки (−) (п.2 ревью). */
  function historyLabel(h) {
    return { sign: Math.sign(h.amount) || 0, text: h.title || 'Событие' };
  }

  return {
    trim, validateName, validatePin, validatePoints, validateTitle, validateComment,
    computeBalance, cartTotal, todayStr, nextDateStr,
    dayAllDone, dayPending, streak, historyLabel
  };
})();
