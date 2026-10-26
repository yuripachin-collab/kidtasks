import { chromium } from 'playwright';
import { spawn } from 'child_process';

/* Отладка шага 9: дампим состояние БД и DOM прямо из страницы */
const server = spawn(process.execPath, ['server.js', '8812'], { cwd: new URL('.', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300)); });

await page.goto('http://localhost:8812/');
await page.waitForSelector('#s-onboard', { state: 'visible' });
await page.fill('#ob-name', 'Юра');
await page.fill('#ob-pin', '1234');
await page.fill('#ob-pin2', '1234');
await page.click('#ob-submit');
await page.waitForSelector('#s-role', { state: 'visible' });

await page.click('#role-parent');
await page.fill('#pin-pass', '1234');
await page.click('#pin-submit');
await page.waitForSelector('#s-parent', { state: 'visible' });

for (const [name, pts] of [['Вынести мусор', '10'], ['Читать 30 минут', '10']]) {
  await page.click('[data-act="newtask"]');
  await page.fill('#p-task-name', name);
  await page.fill('#p-task-points', pts);
  await page.click('[data-act="savetask"]');
  await page.waitForFunction((n) => document.querySelector('#p-tasks').innerText.includes(n), name);
}
await page.click('#p-logout');
await page.click('#role-child');
await page.waitForSelector('#s-child', { state: 'visible' });
await page.waitForFunction(() => document.querySelector('#c-request').innerText.includes('Что мне сегодня делать?'));
await page.click('#c-request [data-action="request"]');
await page.waitForFunction(() => document.querySelector('#c-request').innerText.includes('Запрос отправлен'));

const before = await page.evaluate(async () => ({
  request: await window.Ops.getRequest(),
  day: await window.DB.get('days', window.DB.todayStr())
}));
console.log('ПОСЛЕ ЗАПРОСА:', JSON.stringify(before));

await page.click('#child-switch');
await page.click('#role-parent');
await page.fill('#pin-pass', '1234');
await page.click('#pin-submit');
await page.waitForSelector('#s-parent', { state: 'visible' });
await page.waitForTimeout(2500); // даём всему отрендериться/сработать

const after = await page.evaluate(async () => ({
  request: await window.Ops.getRequest(),
  day: await window.DB.get('days', window.DB.todayStr()),
  prequestHTML: (document.querySelector('#p-request')?.outerHTML || '').slice(0, 400),
  hidden: [...document.querySelectorAll('.screen')].find((s) => !s.hidden)?.id
}));
console.log('ПОСЛЕ ВХОДА РОДИТЕЛЯ:', JSON.stringify(after, null, 1));

await browser.close();
server.kill();
