'use strict';
/* KidTasks · интерфейс: роутинг экранов, роли, рендеры, обработчики.
   Правила — в Rules, операции с данными — в Ops (одна транзакция на операцию). */
window.App = (function () {
  const $ = (s) => document.querySelector(s);
  const D = window.DB, R = window.Rules, Ops = window.Ops;

  const state = {
    config: null, role: null,
    taskFormOpen: false, editingTaskId: null,
    prodFormOpen: false, editingProductId: null, prodPhoto: null,
    prodSeq: 0, prodPendingSeq: null,
    issueArmed: false, resetArmed: false
  };

  /* ---------- утилиты ---------- */
  function show(id) { document.querySelectorAll('.screen').forEach((s) => { s.hidden = (s.id !== id); }); }
  /* п.22 ревью: защита от двойных нажатий — одна операция за раз */
  let busy = false;
  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } finally { busy = false; }
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._tm); toast._tm = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTs(ts) {
    return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function dateLine() {
    const d = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  function applyTheme(t) {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }
  function switchTab(barId, tab) {
    document.querySelectorAll('#' + barId + ' .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const root = document.getElementById(barId).closest('.screen');
    root.querySelectorAll('section[id^="pane-"]').forEach((p) => { p.hidden = true; });
    const pane = document.getElementById('pane-' + tab);
    if (pane) pane.hidden = false;
  }

  /* ---------- загрузка ---------- */
  async function boot() {
    try {
      await D.open();
      state.config = await Ops.getConfig();
    } catch (err) {
      // п.5 ревью-2: ошибка чтения — НЕ открываем онбординг вслепую
      show('s-onboard');
      $('#ob-err').textContent = 'Хранилище недоступно: ' + (err && err.message ? err.message : 'неизвестная ошибка');
      return;
    }
    applyTheme((state.config && state.config.theme) || 'light');
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((ok) => { if (!ok) toast('Хранилище может быть очищено системой'); }).catch(() => {});
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js')
        .then(async (reg) => { await navigator.serviceWorker.ready; toast('Готово к работе без интернета'); })
        .catch(() => { toast('Оффлайн-режим недоступен'); });
    }
    try {
      await D.ensureToday();
    } catch (err) {
      // конфигурация целá — показываем роли, но честно говорим про ошибку (п.5/6 ревью-2)
      toast('Ошибка хранилища: ' + (err && err.message ? err.message : 'неизвестная'));
    }
    if (!state.config) { show('s-onboard'); return; }
    $('#role-child-name').textContent = state.config.childName;
    show('s-role');
  }

  /* ---------- онбординг ---------- */
  $('#ob-submit').addEventListener('click', async () => {
    const errEl = $('#ob-err'); errEl.textContent = '';
    const name = R.validateName($('#ob-name').value); if (!name.ok) { errEl.textContent = name.err; return; }
    const pin = R.validatePin($('#ob-pin').value); if (!pin.ok) { errEl.textContent = pin.err; return; }
    if ($('#ob-pin').value !== $('#ob-pin2').value) { errEl.textContent = 'PIN не совпал'; return; }
    try {
      const salt = Ops.randomSalt();
      const hash = await Ops.hashPin(pin.value, salt);
      await Ops.saveConfig({ childName: name.value, pin: { salt, hash }, theme: 'light' });
      state.config = await Ops.getConfig();
      applyTheme('light');
      $('#ob-pin').value = ''; $('#ob-pin2').value = ''; // п.30 ревью: не оставляем PIN в полях
      $('#role-child-name').textContent = name.value;
      show('s-role');
    } catch (err) { errEl.textContent = err.message || 'Не получилось сохранить'; } // п.6 ревью-2
  });

  /* ---------- роли и PIN ---------- */
  $('#role-child').addEventListener('click', enterChild);
  $('#role-parent').addEventListener('click', () => {
    $('#pin-pass').value = ''; $('#pin-err').textContent = '';
    $('#pin-reset').hidden = true; state.resetArmed = false;
    show('s-pin'); refreshLockMsg();
  });
  $('#child-switch').addEventListener('click', () => {
    state.role = null;
    $('#role-child-name').textContent = state.config ? state.config.childName : '';
    show('s-role');
  });
  $('#p-logout').addEventListener('click', () => {
    state.role = null;
    state.issueArmed = false; // п.7 ревью-2: подтверждение не переживает смену роли
    show('s-role');
  });

  async function enterChild() {
    await D.ensureToday();
    state.role = 'child';
    $('#child-hello').textContent = 'Привет, ' + state.config.childName + '!';
    $('#child-date').textContent = dateLine();
    show('s-child');
    switchTab('tabbar-child', 'c-tasks');
    await renderChildTasks(); await renderChildShop(); await renderHistory($('#c-history'));
  }
  async function enterParent() {
    await D.ensureToday();
    state.role = 'parent';
    show('s-parent');
    switchTab('tabbar-parent', 'p-tasks');
    await renderParentTasks(); await renderParentShop(); await renderParentBalance(); await renderParentSettings();
  }

  async function refreshLockMsg() {
    const lock = await Ops.getPinLock();
    const left = lock.until - Date.now();
    if (left > 0) {
      $('#pin-submit').disabled = true;
      $('#pin-err').textContent = 'Слишком много попыток. Подождите ' + Math.ceil(left / 1000) + ' с';
      setTimeout(refreshLockMsg, 1000);
    } else {
      $('#pin-submit').disabled = false;
    }
  }
  $('#pin-submit').addEventListener('click', async () => {
    if (busy) return;
    busy = true; // п.4 ревью-2: захват до первого await
    const errEl = $('#pin-err');
    try {
      const lock = await Ops.getPinLock();
      if (lock.until > Date.now()) return;
      const pass = $('#pin-pass').value;
      const ok = await Ops.verifyPin(pass, state.config.pin);
      if (ok) {
        await Ops.putPinLock({ fails: 0, until: 0 });
        $('#pin-pass').value = '';
        await enterParent();
        return;
      }
      const fails = (lock.fails || 0) + 1;
      $('#pin-pass').value = '';
      if (fails >= 5) {
        await Ops.putPinLock({ fails: 0, until: Date.now() + 30000 });
        errEl.textContent = '5 неверных попыток — пауза 30 секунд';
      } else {
        await Ops.putPinLock({ fails, until: 0 });
        errEl.textContent = 'Неверный PIN (попытка ' + fails + ' из 5)';
      }
    } catch (err) { errEl.textContent = err.message || 'Ошибка входа'; }
    finally { busy = false; refreshLockMsg(); }
  });
  $('#pin-forgot').addEventListener('click', () => {
    const box = $('#pin-reset');
    box.hidden = !box.hidden;
    state.resetArmed = false;
    $('#pin-reset-go').textContent = 'Стереть всё и настроить заново';
  });
  $('#pin-reset-go').addEventListener('click', async () => {
    if (!state.resetArmed) {
      state.resetArmed = true;
      $('#pin-reset-go').textContent = 'Точно стереть? Нажмите ещё раз';
      return;
    }
    await Ops.resetAll();
    location.reload();
  });

  /* п.10 ревью-2: возврат из фона — обновляем день и данные, но НЕ перерисовываем открытые формы */
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !state.role) return;
    try {
      await D.ensureToday();
      if (state.taskFormOpen || state.prodFormOpen) return; // беречём введённые значения
      $('#child-date').textContent = dateLine();
      if (state.role === 'child') { await renderChildTasks(); await renderChildShop(); await renderHistory($('#c-history')); }
      else { await renderParentTasks(); await renderParentShop(); await renderParentBalance(); }
    } catch (err) { /* тихо: экран останется прежним до следующего действия */ }
  });

  /* ---------- вкладки ---------- */
  $('#tabbar-child').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (b) switchTab('tabbar-child', b.dataset.tab);
  });
  $('#tabbar-parent').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (b) switchTab('tabbar-parent', b.dataset.tab);
  });

  /* ---------- подросток: задачи ---------- */
  async function renderChildTasks() {
    await D.ensureToday();
    const today = D.todayStr(); // дата ПОСЛЕ ensureToday (п.2 ревью-2)
    const day = await D.get('days', today);
    const hist = await D.all('history');
    const cart = await D.all('cart');
    const bal = R.computeBalance(hist);
    const inCart = R.cartTotal(cart);
    const days = await D.all('days');
    $('#child-streak').textContent = '🔥 ' + R.streak(days, today);
    $('#c-balance-card').innerHTML =
      '<div class="row"><div style="flex:1;min-width:0">'
      + '<div class="label" style="margin:0">Доступно</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:34px;font-weight:800;font-variant-numeric:tabular-nums"><span class="star">⭐</span>' + bal + '</div></div>'
      + '<div class="sub2" style="text-align:right">Уже в корзине:<br><b style="color:var(--violet-ink)">' + inCart + ' ⭐</b> (списано)</div></div>';
    const list = $('#c-tasks-list'), head = $('#c-tasks-head'), reqBox = $('#c-request');
    const items = day ? day.items : [];
    if (items.length === 0) {
      head.hidden = true; list.innerHTML = '';
      const req = await Ops.getRequest();
      const sent = req && !req.closed;
      reqBox.innerHTML = '<div class="empty"><div class="emo">🗒️</div>'
        + '<div class="t">На сегодня ничего не назначено</div>'
        + (sent
          ? '<div class="s">Напоминание уже отправлено (' + req.date + ').</div><span class="chip chip-violet">✓ Запрос отправлен</span>'
          : '<div class="s">Похоже, родитель ещё не заполнил задачи.<br>Напомни ему — он увидит в приложении.</div>'
            + '<button class="btn" data-action="request" style="min-height:50px">Что мне сегодня делать?</button>')
        + '</div>';
      return;
    }
    reqBox.innerHTML = ''; head.hidden = false;
    const doneN = items.filter((i) => i.done).length;
    $('#c-tasks-count').textContent = doneN + ' из ' + items.length;
    list.innerHTML = items.map((i) =>
      '<div class="card row">'
      + '<div class="mid"><div class="name"' + (i.done ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' + esc(i.name) + '</div>'
      + '<div class="sub2" style="color:var(--coin-ink);font-weight:700">+' + i.points + ' ⭐</div></div>'
      + (i.done
        ? '<button class="btn btn-ghost" data-action="done" data-date="' + today + '" data-id="' + i.taskId + '">Снять</button>'
        : '<button class="btn" data-action="done" data-date="' + today + '" data-id="' + i.taskId + '">Готово ✓</button>')
      + '</div>').join('');
  }
  $('#pane-c-tasks').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
    await withBusy(async () => {
      try {
        if (b.dataset.action === 'request') { await Ops.setRequest(); await renderChildTasks(); }
        if (b.dataset.action === 'done') {
          // п.2 ревью-2: кнопка помнит свой день; устаревшая (после полуночи) — отклонится операцией
          if (b.textContent.indexOf('Снять') === 0) {
            const bal = await Ops.balance();
            const day = await D.get('days', b.dataset.date);
            const item = day && day.items.find((i) => i.taskId === b.dataset.id);
            if (item && bal < item.points) { toast('Сначала убери лишнее из корзины'); return; }
          }
          await Ops.completeTask(b.dataset.date, b.dataset.id);
          await renderChildTasks(); await renderChildShop(); await renderHistory($('#c-history'));
        }
      } catch (err) { toast(err.message || 'Не получилось'); }
    });
  });

  /* ---------- подросток: магазин (разметка — styles/shop.css; логика обмена не менялась) ---------- */
  const ICONS = {
    cart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1.2 12H7.2L6 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
    gift: '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="1.5"/><path d="M3 7.5h18V11H3z"/><path d="M12 7.5V20"/><path d="M12 7.5C8.5 7.5 7 6.3 7 4.9 7 3.9 7.8 3 8.9 3c1.5 0 2.6 1.6 3.1 4.5zm0 0C15.5 7.5 17 6.3 17 4.9 17 3.9 16.2 3 15.1 3c-1.5 0-2.6 1.6-3.1 4.5z"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  async function renderChildShop() {
    await D.ensureToday();
    const products = await D.all('products');
    const cart = await D.all('cart');
    const bal = R.computeBalance(await D.all('history'));
    const total = R.cartTotal(cart);
    const star = ' <span class="st" aria-hidden="true">★</span>'; // знак валюты: типографика, не эмодзи (гейт 30a)
    let html = '<div class="card shop-balance"><span class="shop-lbl">Доступно</span>'
      + '<span class="chip chip-coin"><span class="star" aria-hidden="true">★</span>' + bal + '</span></div>'; // п.26 ревью; текст чипа «★N» проверяет e2e
    if (cart.length > 0) {
      html += '<section class="card shop-cart"><div class="shop-head"><h2 class="shop-h2">' + ICONS.cart + 'Корзина</h2>'
        + '<span class="chip chip-violet">' + cart.reduce((s, p) => s + p.qty, 0) + ' шт</span></div>';
      for (const p of cart) {
        html += '<div class="shop-crow">'
          + '<div class="shop-crow-mid"><div class="shop-name">' + esc(p.name) + (p.qty > 1 ? ' ×' + p.qty : '') + '</div>'
          + '<div class="shop-sub">' + p.unitPrice + star + ' за штуку</div></div>'
          + '<b class="shop-sum">' + p.unitPrice * p.qty + star + '</b>'
          + '<button class="shop-x" data-action="unit" data-key="' + p.key + '" aria-label="Убрать одну штуку">' + ICONS.x + '</button></div>';
      }
      html += '<div class="shop-total"><span class="shop-sub">Итого: <b class="shop-wait">ожидает родителя</b></span>'
        + '<b class="shop-sum shop-sum-big">' + total + star + '</b></div></section>';
    }
    html += '<section class="shop-catalog"><div class="shop-head"><h2 class="shop-h2">Награды</h2>'
      + (products.length ? '<span class="shop-count">' + products.length + '</span>' : '') + '</div>';
    if (products.length === 0) {
      html += '<div class="empty"><div class="emo">' + ICONS.gift + '</div><div class="t">Магазин пока пуст</div><div class="s">Родитель добавит товары. Они появятся здесь.</div></div>';
    } else {
      html += '<div class="shop-grid">';
      for (const p of products) {
        const afford = bal >= p.price;
        const img = p.photo
          ? '<img class="shop-pic" src="' + p.photo + '" alt="" decoding="async">'
          : '<div class="shop-pic shop-pic-ph" role="img" aria-label="Фото не добавлено">' + ICONS.gift + '</div>';
        html += '<article class="card shop-item">' + img
          + '<h3 class="shop-name">' + esc(p.name) + '</h3>'
          + '<div class="shop-price"><span class="star" aria-hidden="true">★</span>' + p.price + '</div>'
          + (afford
            ? '<button class="btn shop-buy" data-action="add" data-id="' + p.id + '">Обменять</button>'
            : '<button class="btn btn-ghost shop-buy" disabled>Не хватает ' + (p.price - bal) + star + '</button>')
          + '</article>';
      }
      html += '</div>';
    }
    html += '</section>';
    $('#c-shop').innerHTML = html;
  }
  $('#pane-c-shop').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
    await withBusy(async () => {
      try {
        if (b.dataset.action === 'add') {
          await Ops.cartAdd(b.dataset.id);
          await renderChildShop(); await renderChildTasks(); await renderHistory($('#c-history'));
        }
        if (b.dataset.action === 'unit') {
          await Ops.cartRemoveUnit(b.dataset.key, false);
          await renderChildShop(); await renderChildTasks(); await renderHistory($('#c-history'));
        }
      } catch (err) { toast(err.message || 'Не получилось'); }
    });
  });

  /* ---------- история ---------- */
  async function renderHistory(el) {
    if (!el) return;
    const hist = (await D.all('history')).slice().reverse();
    if (hist.length === 0) {
      el.innerHTML = '<div class="empty"><div class="emo">📜</div><div class="t">Пока пусто</div><div class="s">Здесь появятся все движения баллов.</div></div>';
      return;
    }
    el.innerHTML = hist.map((h) => {
      const lbl = R.historyLabel(h);
      const color = lbl.sign > 0 ? 'var(--accent-ink)' : (lbl.sign < 0 ? 'var(--pink-ink)' : 'var(--muted)');
      const amt = lbl.sign === 0 ? '0' : (lbl.sign > 0 ? '+' : '−') + Math.abs(h.amount);
      return '<div class="card row"><div class="mid"><div class="name">' + esc(lbl.text) + '</div>'
        + '<div class="sub2">' + fmtTs(h.ts) + '</div></div>'
        + '<b style="color:' + color + ';font-variant-numeric:tabular-nums">' + amt + ' ⭐</b></div>';
    }).join('');
  }

  /* ---------- родитель: задачи ---------- */
  async function parentCommon() {
    await D.ensureToday();
    return {
      today: D.todayStr(), tomorrow: R.nextDateStr(),
      hist: await D.all('history'), cart: await D.all('cart'),
      products: await D.all('products'), tasks: await D.all('tasks')
    };
  }
  async function renderParentTasks() {
    const c = await parentCommon();
    const bal = R.computeBalance(c.hist);
    $('#parent-sub').innerHTML = esc(state.config.childName) + ' · доступно <b style="color:var(--coin-ink)">' + bal + ' ⭐</b>';
    const day = await D.get('days', c.today);
    const req = await Ops.getRequest();
    const box = $('#p-request');
    if (req && !req.closed) {
      const dayFull = day && day.items.length > 0;
      box.innerHTML = '<div class="banner banner-pink"><span>❗ ' + esc(state.config.childName)
        + ' спросил «что мне сегодня делать?» (' + esc(req.date) + ')</span>'
        + '<span style="display:flex;gap:8px;flex-wrap:wrap">'
        + (dayFull
          ? '' // п.12 ревью-2: день уже заполнен — назначать нечего
          : '<button class="btn" data-act="assign" style="min-height:44px">Назначить на сегодня</button>')
        + '<button class="btn-text" data-act="closereq">Закрыть</button></span></div>';
    } else box.innerHTML = '';

    let html = '<div class="sec"><h2>Сегодня: выполнение</h2><span class="count">'
      + (day ? day.items.filter((i) => i.done).length : 0) + ' из ' + (day ? day.items.length : 0) + '</span></div>';
    if (!day || day.items.length === 0) {
      html += '<div class="empty"><div class="emo">🗒️</div><div class="t">На сегодня список пуст</div><div class="s">'
        + (req && !req.closed ? 'Ответьте на запрос кнопкой «Назначить на сегодня» — задачи появятся у ' + esc(state.config.childName) + ' сразу.'
                            : 'Новые задачи появятся в списке с завтрашнего дня.') + '</div></div>';
    } else {
      html += day.items.map((i) =>
        '<div class="card row"><div class="mid"><div class="name"'
        + (i.done ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' + esc(i.name)
        + '</div><div class="sub2">+' + i.points + ' ⭐' + (i.done ? ' · выполнено' : '') + '</div></div></div>').join('');
    }
    html += '<div class="sec" style="margin-top:6px"><h2>С ' + c.tomorrow + ': изменения</h2>'
      + '<button class="btn" data-act="newtask" style="min-height:44px">+ Задача</button></div>';
    const active = c.tasks.filter((t) => !t.archived);
    if (active.length === 0) {
      html += '<div class="empty"><div class="emo">📋</div><div class="t">Задач пока нет</div><div class="s">Нажмите «+ Задача», чтобы добавить первую.</div></div>';
    } else {
      html += active.map((t) =>
        '<div class="card row"><div class="mid"><div class="name">' + esc(t.name) + '</div>'
        + '<div class="sub2">+' + t.points + ' ⭐' + (t.since > c.today ? ' · действует с ' + t.since : '') + '</div></div>'
        + '<button class="btn btn-ghost" data-act="edit" data-id="' + t.id + '">Изменить</button>'
        + '<button class="btn-text" data-act="del" data-id="' + t.id + '">Удалить</button></div>').join('');
    }
    html += '<div class="card" id="p-task-form"' + (state.taskFormOpen ? '' : ' hidden') + ' style="display:flex;flex-direction:column;gap:10px">'
      + '<b>' + (state.editingTaskId ? 'Изменить задачу' : 'Новая задача') + '</b>'
      + '<div class="field"><label for="p-task-name">Название</label><input id="p-task-name" maxlength="60" placeholder="Например, Убрать комнату"></div>'
      + '<div class="field"><label for="p-task-points">Баллы (1–999)</label><input id="p-task-points" inputmode="numeric" maxlength="4" placeholder="10"></div>'
      + '<div class="sub2">Подействует с ' + c.tomorrow + ' — сегодняшний список не изменится.</div>'
      + '<div class="formerr" id="p-task-err"></div>'
      + '<div class="row"><button class="btn" data-act="savetask" style="flex:1">Сохранить</button>'
      + '<button class="btn-text" data-act="canceltask">Отмена</button></div></div>';
    $('#p-tasks').innerHTML = html;
    if (state.taskFormOpen && state.editingTaskId) {
      const t = c.tasks.find((x) => x.id === state.editingTaskId);
      $('#p-task-name').value = t ? t.name : '';
      $('#p-task-points').value = t ? t.points : '';
    }
  }
  /* п.6 ревью: обработчик на всей панели задач — баннер запроса живёт в #p-request, рядом с #p-tasks */
  $('#pane-p-tasks').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    await withBusy(async () => {
      try {
        if (act === 'newtask') { state.taskFormOpen = true; state.editingTaskId = null; await renderParentTasks(); }
        if (act === 'edit') { state.taskFormOpen = true; state.editingTaskId = b.dataset.id; await renderParentTasks(); }
        if (act === 'canceltask') { state.taskFormOpen = false; state.editingTaskId = null; await renderParentTasks(); }
        if (act === 'del') {
          if (confirm('Удалить задачу? История и баллы не изменятся.')) {
            await Ops.deleteTask(b.dataset.id); await renderParentTasks();
          }
        }
        if (act === 'savetask') {
          const task = { name: $('#p-task-name').value, points: $('#p-task-points').value };
          if (state.editingTaskId) task.id = state.editingTaskId;
          await Ops.saveTask(task);
          state.taskFormOpen = false; state.editingTaskId = null;
          await renderParentTasks(); toast('Сохранено — подействует с завтрашнего дня');
        }
        if (act === 'assign') {
          const tasks = await D.all('tasks');
          if (!tasks.some((t) => !t.archived)) { toast('Сначала добавьте задачи в списке ниже'); return; } // п.14 ревью
          await Ops.assignToday();
          await renderParentTasks(); toast('Назначено на сегодня');
        }
        if (act === 'closereq') { await Ops.closeRequest(); await renderParentTasks(); }
      } catch (err) {
        const el = $('#p-task-err'); if (el && state.taskFormOpen) el.textContent = err.message; else toast(err.message || 'Не получилось');
      }
    });
  });

  /* ---------- родитель: магазин ---------- */
  function fileToDataUrl(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc));
        cv.height = Math.max(1, Math.round(img.height * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать фото')); };
      img.src = url;
    });
  }
  async function renderParentShop() {
    const c = await parentCommon();
    let html = '';
    if (c.cart.length > 0) {
      const total = R.cartTotal(c.cart);
      html += '<div class="card"><div class="row" style="justify-content:space-between"><b style="font-size:16px">🛒 Корзина '
        + esc(state.config.childName) + '</b><span class="chip chip-violet">'
        + c.cart.reduce((s, p) => s + p.qty, 0) + ' шт · ' + total + ' ⭐</span></div>';
      for (const p of c.cart) {
        html += '<div class="row" style="padding:9px 0;border-bottom:1px solid var(--line)">'
          + '<div class="mid"><div class="name">' + esc(p.name) + (p.qty > 1 ? ' ×' + p.qty : '') + '</div>'
          + '<div class="sub2">' + p.unitPrice + ' ⭐ за штуку</div></div>'
          + '<b style="font-variant-numeric:tabular-nums">' + p.unitPrice * p.qty + ' ⭐</b>'
          + '<button class="btn-text" data-act="posrm" data-key="' + p.key + '">убрать</button></div>';
      }
      html += '<div class="row" style="justify-content:space-between;margin-top:9px;padding-top:10px;border-top:1px solid var(--line)">'
        + '<span class="sub2">к выдаче (баллы уже списаны)</span>'
        + '<b style="font-size:16px;font-variant-numeric:tabular-nums">' + total + ' ⭐</b></div>';
      if (state.issueArmed) {
        html += '<div class="banner banner-violet" style="margin-top:11px;flex-direction:column;align-items:stretch;gap:6px">'
          + '<b>Выдать всё?</b><span>Корзина опустеет, в истории появятся отметки о выдаче. Баллы повторно не списываются.</span>'
          + '<div class="row" style="margin-top:4px"><button class="btn" data-act="issueyes" style="flex:1">✓ Выдано</button>'
          + '<button class="btn-text" data-act="issueno">Отмена</button></div></div>';
      } else {
        html += '<button class="btn btn-big" data-act="issue" style="margin-top:11px">✓ Выдано</button>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty"><div class="emo">🛒</div><div class="t">Корзина пуста</div>'
        + '<div class="s">Когда ' + esc(state.config.childName) + ' добавит товары, они появятся здесь.</div></div>';
    }
    html += '<div class="sec"><h2>Каталог</h2><button class="btn" data-act="newprod" style="min-height:44px">+ Товар</button></div>';
    if (state.prodFormOpen) {
      const editing = state.editingProductId ? c.products.find((x) => x.id === state.editingProductId) : null;
      html += '<div class="card" style="display:flex;flex-direction:column;gap:10px"><b>' + (editing ? 'Изменить товар' : 'Новый товар') + '</b>'
        + '<div class="field"><label for="p-prod-name">Название</label><input id="p-prod-name" maxlength="60" value="' + (editing ? esc(editing.name) : '') + '"></div>'
        + '<div class="field"><label for="p-prod-price">Цена в баллах (1–999)</label><input id="p-prod-price" inputmode="numeric" maxlength="4" value="' + (editing ? editing.price : '') + '"></div>'
        + '<div class="field"><label for="p-prod-photo">Фото (необязательно, сожмём сами)</label><input id="p-prod-photo" type="file" accept="image/*"></div>'
        + '<div id="p-prod-preview">' + (editing && editing.photo ? '<img src="' + editing.photo + '" alt="" style="height:80px;border-radius:10px">' : '') + '</div>'
        + '<div class="formerr" id="p-prod-err"></div>'
        + '<div class="row"><button class="btn" data-act="saveprod" style="flex:1">Сохранить</button>'
        + '<button class="btn-text" data-act="cancelpord">Отмена</button></div></div>';
    } else if (c.products.length === 0) {
      html += '<div class="empty"><div class="emo">🎁</div><div class="t">Товаров пока нет</div><div class="s">Добавьте первый товар — он появится в магазине подростка.</div></div>';
    } else {
      for (const p of c.products) {
        const img = p.photo
          ? '<img src="' + p.photo + '" alt="" style="width:36px;height:36px;border-radius:10px;object-fit:cover">'
          : '<div class="ico">🎁</div>';
        html += '<div class="card row">' + img
          + '<div class="mid"><div class="name">' + esc(p.name) + '</div><div class="sub2">' + p.price + ' ⭐</div></div>'
          + '<button class="btn btn-ghost" data-act="pedit" data-id="' + p.id + '">Изменить</button>'
          + '<button class="btn-text" data-act="pdel" data-id="' + p.id + '">Удалить</button></div>';
      }
    }
    $('#p-shop').innerHTML = html;
  }
  $('#p-shop').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    await withBusy(async () => {
      try {
        if (act === 'issue') { state.issueArmed = true; await renderParentShop(); }
        if (act === 'issueno') { state.issueArmed = false; await renderParentShop(); }
        if (act === 'issueyes') {
          await Ops.issueCart(); state.issueArmed = false;
          await renderParentShop(); await renderParentBalance(); await renderParentTasks(); toast('Корзина выдана');
        }
        if (act === 'posrm') {
          if (confirm('Убрать позицию из корзины? Баллы вернутся ' + state.config.childName + '.')) {
            state.issueArmed = false; // состав корзины изменился (п.7 ревью-2)
            await Ops.cartRemovePosition(b.dataset.key);
            await renderParentShop(); await renderParentBalance(); await renderParentTasks();
          }
        }
        if (act === 'newprod') { state.prodFormOpen = true; state.editingProductId = null; state.prodPhoto = null; state.prodSeq++; await renderParentShop(); }
        if (act === 'pedit') { state.prodFormOpen = true; state.editingProductId = b.dataset.id; state.prodPhoto = null; state.prodSeq++; await renderParentShop(); }
        if (act === 'cancelpord') { state.prodFormOpen = false; state.editingProductId = null; state.prodPhoto = null; state.prodSeq++; await renderParentShop(); }
        if (act === 'pdel') {
          if (confirm('Удалить товар из каталога? Корзина и история не изменятся.')) { // п.7 ревью
            await Ops.deleteProduct(b.dataset.id);
            await renderParentShop(); toast('Товар удалён');
          }
        }
        if (act === 'saveprod') {
          if (state.prodPendingSeq === state.prodSeq && state.prodPendingSeq !== null) return; // п.8 ревью-2: фото ещё читается
          const product = { name: $('#p-prod-name').value, price: $('#p-prod-price').value, photo: state.prodPhoto };
          if (state.editingProductId) {
            product.id = state.editingProductId;
            const old = (await D.all('products')).find((x) => x.id === state.editingProductId);
            if (old && !state.prodPhoto) product.photo = old.photo;
          }
          await Ops.saveProduct(product);
          state.prodFormOpen = false; state.editingProductId = null; state.prodPhoto = null;
          await renderParentShop(); toast('Товар сохранён');
        }
      } catch (err) {
        const el = $('#p-prod-err'); if (el && state.prodFormOpen) el.textContent = err.message; else toast(err.message || 'Не получилось');
      }
    });
  });
  $('#p-shop').addEventListener('change', async (e) => {
    if (e.target.id !== 'p-prod-photo' || !e.target.files || !e.target.files[0]) return;
    const seq = state.prodSeq; // п.8 ревью-2: фото привязано к конкретной форме
    const saveBtn = document.querySelector('#p-shop [data-act="saveprod"]');
    state.prodPendingSeq = seq; if (saveBtn) saveBtn.disabled = true;
    try {
      const dataUrl = await fileToDataUrl(e.target.files[0], 512);
      if (state.prodSeq !== seq) return; // форма сменилась, пока читали
      state.prodPhoto = dataUrl;
      $('#p-prod-preview').innerHTML = '<img src="' + dataUrl + '" alt="" style="height:80px;border-radius:10px">';
    } catch (err) { toast(err.message || 'Фото не прочиталось'); }
    finally { if (state.prodPendingSeq === seq) state.prodPendingSeq = null; if (saveBtn) saveBtn.disabled = false; }
  });

  /* ---------- родитель: баланс ---------- */
  async function renderParentBalance() {
    const c = await parentCommon();
    const bal = R.computeBalance(c.hist);
    let html = '<div class="card row"><div class="mid"><div class="label" style="margin:0">Доступно</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:34px;font-weight:800;font-variant-numeric:tabular-nums"><span class="star">⭐</span>' + bal + '</div></div></div>';
    html += '<div class="card" style="display:flex;flex-direction:column;gap:10px"><b>Корректировка</b>'
      + '<div class="field"><label for="p-adj-amount">Сумма (1–999)</label><input id="p-adj-amount" inputmode="numeric" maxlength="4" placeholder="10"></div>'
      + '<div class="field"><label for="p-adj-comment">Комментарий (обязательно)</label><input id="p-adj-comment" maxlength="100" placeholder="Например, помог собрать рюкзак"></div>'
      + '<div class="formerr" id="p-adj-err"></div>'
      + '<div class="row"><button class="btn" data-act="earn" style="flex:1">+ Начислить</button>'
      + '<button class="btn btn-ghost" data-act="deduct" style="flex:1">− Списать</button></div></div>';
    html += '<div class="label">Полная история</div><div id="p-history" style="display:flex;flex-direction:column;gap:8px"></div>';
    $('#p-balance').innerHTML = html;
    await renderHistory($('#p-history'));
  }
  $('#p-balance').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    await withBusy(async () => {
      try {
        const sign = b.dataset.act === 'earn' ? 1 : -1;
        await Ops.adjust(sign, $('#p-adj-amount').value, $('#p-adj-comment').value);
        $('#p-adj-amount').value = ''; $('#p-adj-comment').value = '';
        await renderParentBalance(); await renderParentTasks(); toast(sign > 0 ? 'Начислено' : 'Списано');
      } catch (err) {
        const el = $('#p-adj-err'); if (el) el.textContent = err.message; else toast(err.message || 'Не получилось');
      }
    });
  });

  /* ---------- родитель: настройки ---------- */
  async function renderParentSettings() {
    const cfg = state.config;
    const theme = cfg.theme || 'auto';
    const segBtn = (v, label) => '<button class="btn-text" data-act="theme" data-v="' + v
      + '" style="min-height:36px;border-radius:9px' + (theme === v ? ';background:var(--surface);color:var(--ink);box-shadow:var(--shadow)' : '') + '">' + label + '</button>';
    $('#p-settings').innerHTML =
      '<div class="label">Подросток</div>'
      + '<div class="card" style="display:flex;flex-direction:column;gap:10px">'
      + '<div class="field"><label for="p-set-name">Имя</label><input id="p-set-name" maxlength="60" value="' + esc(cfg.childName) + '"></div>'
      + '<div class="formerr" id="p-name-err"></div>'
      + '<button class="btn" data-act="savename">Сохранить имя</button></div>'
      + '<div class="label">Безопасность</div>'
      + '<div class="card" style="display:flex;flex-direction:column;gap:10px">'
      + '<div class="field"><label for="p-pin-cur">Текущий PIN</label><input id="p-pin-cur" type="password" inputmode="numeric" maxlength="4"></div>'
      + '<div class="field"><label for="p-pin-new">Новый PIN (4 цифры)</label><input id="p-pin-new" type="password" inputmode="numeric" maxlength="4"></div>'
      + '<div class="formerr" id="p-pin-err"></div>'
      + '<button class="btn" data-act="savepin">Сменить PIN</button></div>'
      + '<div class="label">Оформление</div>'
      + '<div class="card row" style="justify-content:space-between"><span>Тема</span>'
      + '<div style="display:flex;background:var(--lock);border-radius:11px;padding:3px;gap:2px">'
      + segBtn('light', 'Светлая') + segBtn('auto', 'Авто') + segBtn('dark', 'Тёмная')
      + '</div></div>'
      + '<div class="label">О приложении</div>'
      + '<div class="card"><div class="row"><div class="mid"><div class="name">KidTasks 0.1.0</div>'
      + '<div class="sub2">Данные хранятся только на этом устройстве.</div></div></div></div>'
      + '<button class="btn btn-ghost" data-act="logout2">Выйти из роли родителя</button>';
  }
  $('#p-settings').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    await withBusy(async () => {
      try {
        if (act === 'savename') {
          await Ops.changeName($('#p-set-name').value);
          state.config = await Ops.getConfig();
          $('#role-child-name').textContent = state.config.childName; // п.28 ревью
          await renderParentSettings(); await renderParentTasks(); toast('Имя сохранено');
        }
        if (act === 'savepin') {
          await Ops.changePin($('#p-pin-cur').value, $('#p-pin-new').value);
          state.config = await Ops.getConfig(); // п.18 ревью: иначе текущая сессия примет старый PIN
          $('#p-pin-cur').value = ''; $('#p-pin-new').value = '';
          $('#p-pin-err').textContent = ''; toast('PIN изменён');
        }
        if (act === 'theme') {
          await Ops.setTheme(b.dataset.v);
          state.config = await Ops.getConfig();
          applyTheme(state.config.theme || 'light');
          await renderParentSettings();
        }
        if (act === 'logout2') { state.role = null; show('s-role'); }
      } catch (err) {
        const el = (act === 'savename') ? $('#p-name-err') : $('#p-pin-err');
        if (el) el.textContent = err.message; else toast(err.message || 'Не получилось');
      }
    });
  });

  /* ---------- старт ---------- */
  boot();
  return { state };
})();
