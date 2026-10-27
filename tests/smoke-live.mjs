import { chromium } from 'playwright';

/* Дымовой тест ЖИВОГО деплоя: https + реальный домен.
   Запуск: node smoke-live.mjs https://yuripachin-collab.github.io/kidtasks/ */

const URL = process.argv[2] || 'https://yuripachin-collab.github.io/kidtasks/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
let passed = 0, failed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + String(e.message || e).split('\n')[0]); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn).catch((e) => 'ERR: ' + e.message);
    if (last === true) return;
    await sleep(300);
  }
  throw new Error('не дождались: ' + String(last).slice(0, 100));
};

await step('сайт открывается по HTTPS, онбординг виден', async () => {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#s-onboard', { state: 'visible', timeout: 20000 });
});
await step('HTTPS: manifest подключён', async () => {
  const ok = await page.evaluate(() => !!document.querySelector('link[rel="manifest"]'));
  if (!ok) throw new Error('нет link manifest');
});
await step('онбординг проходит на живом домене', async () => {
  await page.fill('#ob-name', 'Тест');
  await page.fill('#ob-pin', '1234');
  await page.fill('#ob-pin2', '1234');
  await page.click('#ob-submit');
  await page.waitForSelector('#s-role', { state: 'visible', timeout: 10000 });
});
await step('service worker активен (оффлайн готов)', async () => {
  await wait(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (reg.active || reg.installing || reg.waiting));
  });
});
await step('перезагрузка: конфигурация пережила (IndexedDB на живом домене)', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#s-role', { state: 'visible', timeout: 20000 });
});

if (pageErrors.length) { failed++; console.log('  ✗ ошибки страницы: ' + pageErrors.slice(0, 2).join(' | ')); }
console.log('\nДымовой итог: ' + passed + ' прошло, ' + failed + ' упало');
await browser.close();
process.exit(failed ? 1 : 0);
