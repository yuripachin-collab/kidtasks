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

  /* Серия 🔥 (R4): идём назад от сегодня.
     - сегодня: растит серию, только если выполнено всё; незавершённое/пустое — не рвёт и не растит;
     - прошедшие дни: полный ++, пустой (или без снимка) — пауза (пропуск), неполный — разрывает. */
  function streak(days, today) {
    const map = {};
    for (const d of days) map[d.date] = d;
    let s = 0;
    const d = new Date(today + 'T00:00:00');
    for (let i = 0; i < 366; i++) {
      const key = dateStr(d);
      const day = map[key];
      const complete = dayAllDone(day);
      if (key === today) {
        if (complete) s++;
      } else {
        if (!day || day.items.length === 0) { /* пауза */ }
        else if (complete) s++;
        else break;
      }
      d.setDate(d.getDate() - 1);
    }
    return s;
  }

  /* Читаемые подписи истории. */
  function historyLabel(h) {
    switch (h.type) {
      case 'earn': return { sign: 1, text: h.title };
      case 'to_cart': return { sign: -1, text: h.title };
      case 'back': return { sign: 1, text: h.title };
      case 'bonus': return { sign: 1, text: h.title };
      case 'deduct': return { sign: -1, text: h.title };
      case 'issued': return { sign: 0, text: h.title };
      default: return { sign: 0, text: h.title || 'Событие' };
    }
  }

  return {
    trim, validateName, validatePin, validatePoints, validateTitle, validateComment,
    computeBalance, cartTotal, todayStr, nextDateStr,
    dayAllDone, dayPending, streak, historyLabel
  };
})();
