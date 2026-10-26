import { chromium } from 'playwright';
import { spawn } from 'child_process';

/* KidTasks · E2E: реальные сценарии из критериев приёмки в Chromium.
   Запуск: node e2e.mjs (поднимет сервер на :8811 сам) */

const server = spawn(process.execPath, ['server.js', '8811'], { cwd: new URL('.', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) {
    failed++;
    console.log('  ✗ ' + name + ' — ' + String(e.message || e).split('\n')[0]);
    try {
      const state = await page.evaluate(() => ({
        screen: [...document.querySelectorAll('.screen')].find((s) => !s.hidden)?.id,
        pinErr: document.querySelector('#pin-err')?.textContent,
        prequest: document.querySelector('#p-request')?.innerText?.slice(0, 120),
        ptasks: document.querySelector('#p-tasks')?.innerText?.slice(0, 120)
      }));
      console.log('    диагностика: ' + JSON.stringify(state));
      if (pageErrors.length) console.log('    pageerror: ' + pageErrors.slice(-3).join(' | '));
      if (consoleErrors.length) console.log('    console: ' + consoleErrors.slice(-3).join(' | '));
    } catch (_) {}
  }
}
const visible = (sel) => page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
/* Собственный опрос вместо waitForFunction: headless-raf поллинг ведёт себя нестабильно */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (fn, arg, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  let last, i = 0;
  while (Date.now() < deadline) {
    try { last = await page.evaluate(fn, arg); } catch (e) { last = 'ERR: ' + e.message; }
    if (last === true) return;
    i++;
    if (i % 4 === 1) console.log('    [poll ' + i + '] ' + String(last).slice(0, 80));
    await sleep(250);
  }
  try { await page.screenshot({ path: '/tmp/e2e-fail.png' }); } catch (_) {}
  throw new Error('условие не выполнилось; последний результат: ' + String(last).slice(0, 100));
};

try {
  await step('1. онбординг: имя + PIN → выбор роли', async () => {
    await page.goto('http://localhost:8811/');
    await visible('#s-onboard');
    await page.fill('#ob-name', 'Юра');
    await page.fill('#ob-pin', '1234');
    await page.fill('#ob-pin2', '1234');
    await page.click('#ob-submit');
    await visible('#s-role');
  });

  await step('2. перезагрузка: данные на месте, сразу выбор роли', async () => {
    await page.reload();
    await visible('#s-role');
    await text(() => document.querySelector('#role-child-name').textContent === 'Юра');
  });

  await step('3. родитель: неверный PIN — ошибка (критерий 2)', async () => {
    await page.click('#role-parent');
    await visible('#s-pin');
    await page.fill('#pin-pass', '9999');
    await page.click('#pin-submit');
    await text(() => /Неверный PIN/.test(document.querySelector('#pin-err').textContent));
  });

  await step('4. родитель: верный PIN → панель', async () => {
    await page.fill('#pin-pass', '1234');
    await page.click('#pin-submit');
    await visible('#s-parent');
  });

  await step('5. родитель: добавляет две задачи (критерий 3)', async () => {
    for (const [name, pts] of [['Вынести мусор', '10'], ['Читать 30 минут', '10']]) {
      await page.click('[data-act="newtask"]');
      await page.fill('#p-task-name', name);
      await page.fill('#p-task-points', pts);
      await page.click('[data-act="savetask"]');
      await text((n) => document.querySelector('#p-tasks').innerText.includes(n), name);
    }
  });

  await step('6. родитель: добавляет товар', async () => {
    await page.click('#tabbar-parent [data-tab="p-shop"]');
    await page.click('[data-act="newprod"]');
    await page.fill('#p-prod-name', 'Шоколадка');
    await page.fill('#p-prod-price', '10');
    await page.click('[data-act="saveprod"]');
    await text(() => document.querySelector('#p-shop').innerText.includes('Шоколадка'));
  });

  await step('7. родитель: выходит из роли (критерий 1)', async () => {
    await page.click('#p-logout');
    await visible('#s-role');
  });

  await step('8. подросток: пустой день → запрос родителю (критерий 6)', async () => {
    await page.click('#role-child');
    await visible('#s-child');
    await text(() => document.querySelector('#c-request').innerText.includes('Что мне сегодня делать?'));
    await page.click('#c-request [data-action="request"]');
    await text(() => document.querySelector('#c-request').innerText.includes('Запрос отправлен'));
  });

  await step('9. родитель: видит напоминание, назначает на сегодня', async () => {
    await page.click('#child-switch');
    await page.click('#role-parent');
    await page.fill('#pin-pass', '1234');
    await page.click('#pin-submit');
    await visible('#s-parent');
    const pre = await page.evaluate(async () => ({
      request: await window.Ops.getRequest(),
      day: await window.DB.get('days', window.DB.todayStr())
    }));
    console.log('    шаг9 до ожидания: ' + JSON.stringify(pre));
    await text(() => document.querySelector('#p-request').innerText.includes('что мне сегодня делать'));
    await page.click('[data-act="assign"]');
    // счётчик показывает ВЫПОЛНЕНО: 0 из 2 назначенных (никто ещё не отметился)
    await text(() => /0 из 2/.test(document.querySelector('#p-tasks').innerText));
  });

  await step('10. подросток: две задачи выполнены → 20 ⭐ (критерий 4)', async () => {
    await page.click('#p-logout');
    await page.click('#role-child');
    await visible('#s-child');
    const dbg = await page.evaluate(() => ({
      buttons: document.querySelectorAll('#c-tasks-list [data-action="done"]').length,
      rows: document.querySelectorAll('#c-tasks-list .card').length,
      html: document.querySelector('#c-tasks-list').innerHTML.slice(0, 600),
      balance: document.querySelector('#c-balance-card').innerText.slice(0, 40)
    }));
    console.log('    шаг10 t0: ' + JSON.stringify(dbg, null, 1));
    await page.waitForTimeout(2000);
    const dbg2 = await page.evaluate(() => document.querySelectorAll('#c-tasks-list [data-action="done"]').length);
    console.log('    шаг10 t+2s кнопок: ' + dbg2);
    await text(() => {
      const n = document.querySelectorAll('#c-tasks-list [data-action="done"]').length;
      return n === 2 ? true : 'кнопок=' + n + ', строк=' + document.querySelectorAll('#c-tasks-list .card').length
        + ', экран=' + [...document.querySelectorAll('.screen')].find((s) => !s.hidden).id;
    });
    // ВАЖНО: page.click при нескольких совпадениях жмёт первую — кликаем по индексам,
    // иначе второй клик «снимет» первую задачу вместо отметки второй
    await page.locator('#c-tasks-list [data-action="done"]').nth(0).click();
    await page.locator('#c-tasks-list [data-action="done"]').nth(1).click();
    await text(() => document.querySelector('#c-balance-card').innerText.includes('20'));
  });

  await step('11. подросток: шоколадка в корзину ×2 (критерий 7)', async () => {
    await page.click('#tabbar-child [data-tab="c-shop"]');
    await page.click('#c-shop [data-action="add"]');
    await text(() => document.querySelector('#c-shop').innerText.includes('Корзина'));
    await page.click('#c-shop [data-action="add"]');
    await text(() => /×2/.test(document.querySelector('#c-shop').innerText));
    await text(() => document.querySelector('#c-shop .chip-coin').textContent.trim() === '⭐0');
  });

  await step('12. подросток: ✕ убирает штуку — +10 ⭐ вернулись (критерий 7)', async () => {
    await page.click('#c-shop [data-action="unit"]');
    await text(() => document.querySelector('#c-shop .chip-coin').textContent.trim() === '⭐10');
  });

  await step('13. перезагрузка: корзина и баланс живы (критерий 14)', async () => {
    await page.reload();
    await page.click('#role-child');
    await page.click('#tabbar-child [data-tab="c-shop"]');
    // ×1 не пишем — «×N» появляется только при 2+ штуках; проверяем суть: позиция, цена, статус, баланс
    await text(() => document.querySelector('#c-shop').innerText.includes('Шоколадка')
      && document.querySelector('#c-shop').innerText.includes('ожидает родителя')
      && document.querySelector('#c-shop .chip-coin').textContent.trim() === '⭐10');
  });

  await step('14. родитель: «Выдано» с подтверждением → корзина пуста (критерий 9)', async () => {
    await page.click('#child-switch');
    await page.click('#role-parent');
    await page.fill('#pin-pass', '1234');
    await page.click('#pin-submit');
    await page.click('#tabbar-parent [data-tab="p-shop"]');
    await page.click('[data-act="issue"]');
    await page.click('[data-act="issueyes"]');
    await text(() => document.querySelector('#p-shop').innerText.includes('Корзина пуста'));
  });

  await step('15. подросток: в истории есть «Выдано» (критерий 9)', async () => {
    await page.click('#p-logout');
    await page.click('#role-child');
    await page.click('#tabbar-child [data-tab="c-history"]');
    await text(() => document.querySelector('#c-history').innerText.includes('Выдано'));
  });

  await step('16. настройки: тёмная тема включается (R10 спеки)', async () => {
    await page.click('#child-switch');
    await page.click('#role-parent');
    await page.fill('#pin-pass', '1234');
    await page.click('#pin-submit');
    await page.click('#tabbar-parent [data-tab="p-settings"]');
    await page.click('[data-act="theme"][data-v="dark"]');
    await text(() => document.documentElement.getAttribute('data-theme') === 'dark');
  });
} catch (e) {
  failed++;
  console.log('  ✗ непредвиденная ошибка — ' + String(e.message || e).split('\n')[0]);
}

console.log('\nE2E итог: ' + passed + ' прошло, ' + failed + ' упало');
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
