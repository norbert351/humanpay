// HumanPay cinematic live take v2 — onboarding → every view → core action →
// create flow → outputs → closure. Real clicks/typing on the DEPLOYED app.
const puppeteer = require('puppeteer');
const fs = require('fs');

const URL = 'https://humanpay.onrender.com';
const CHROME = '/home/ubuntu/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome';
const timeline = [];
const mark = (phase) => { timeline.push({ phase, t: Date.now() / 1000 }); fs.writeFileSync('demo/timeline.json', JSON.stringify(timeline)); console.log(`[mark] ${phase}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEval(page, fn, label, retries = 8) {
  for (let i = 0; i < retries; i++) {
    try { return await page.evaluate(fn); } catch (e) { if (!/detached Frame/i.test(String(e.message))) throw e; await sleep(250); }
  }
  throw new Error('safeEval gave up: ' + label);
}
async function safeWheel(page, deltaY, label, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try { await page.mouse.wheel({ deltaY }); return; }
    catch (e) { if (!/Session closed|detached Frame|TargetClose|Page has been closed/i.test(String(e.message))) throw e; await sleep(600); }
  }
  throw new Error('safeWheel gave up: ' + label);
}
async function safeGoto(page, url, label, retries = 6) {
  for (let i = 0; i < retries; i++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(1800); return; }
    catch (e) { if (!/detached Frame|net::ERR|Timeout/i.test(String(e.message))) throw e; await sleep(800); }
  }
  throw new Error('safeGoto gave up: ' + label);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--window-position=0,0', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ---- 1. Landing hero ----
  await safeGoto(page, URL + '/', 'landing');
  await sleep(2500);
  mark('hero');
  await sleep(3200);
  await safeWheel(page, 850, "w");
  await sleep(2600);
  mark('sections');
  await sleep(2600);

  // ---- 2. App veil — email login (real onboarding on camera) ----
  await safeGoto(page, URL + '/app', 'app');
  await sleep(3200);
  mark('veil');
  await sleep(2200);
  await safeEval(page, () => {
    const e = document.getElementById('authEmail'); if (e) { e.value = 'demo@humanpay.app'; e.dispatchEvent(new Event('input', { bubbles: true })); }
    const p = document.getElementById('authPass'); if (p) { p.value = 'demo-pass-123'; p.dispatchEvent(new Event('input', { bubbles: true })); }
  }, 'fill-login');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /log in/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'click-login');
  await sleep(3000);
  mark('authenticated');
  await sleep(4000); // rails load

  // ---- 3. Rail status panel ----
  await safeWheel(page, 350, "w");
  await sleep(2200);
  mark('rails');
  await sleep(4200);

  // ---- 4. Core action: tip form + drain-test (blocked) ----
  await safeWheel(page, 400, "w");
  await sleep(2000);
  mark('tipform');
  await sleep(2800);
  await safeEval(page, () => {
    const amt = document.getElementById('amount'); if (amt) { amt.value = '999999'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
  }, 'drain-fill');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /drain/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'drain');
  await sleep(2800);
  mark('drainblock');
  await sleep(3000);

  // ---- 5. Receipts + CSV ----
  await safeWheel(page, 400, "w");
  await sleep(2000);
  mark('receipts');
  await sleep(3300);

  // ---- 6. Pay link (populated peers) ----
  await safeWheel(page, 900, "w");
  await sleep(2400);
  mark('paylink');
  await sleep(3000);

  // ---- 7. Create/produce: split-a-bill ----
  await safeEval(page, () => {
    const t = document.getElementById('billTitle'); if (t) { t.value = 'Team dinner'; }
    const tot = document.getElementById('billTotal'); if (tot) { tot.value = '36'; }
    const r = document.getElementById('billRecipients'); if (r) { r.value = '@alice, @bob'; }
  }, 'bill-fill');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Create bill/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'bill');
  await sleep(2600);
  mark('splitbill');
  await sleep(3200);

  // ---- 8. Subscriptions (pre-seeded + create) ----
  await safeEval(page, () => {
    const p = document.getElementById('subPayee'); if (p) { p.value = '@bob'; }
    const a = document.getElementById('subAmt'); if (a) { a.value = '2'; }
    const iv = document.getElementById('subIv'); if (iv) { iv.value = '3600'; }
    const l = document.getElementById('subLabel'); if (l) { l.value = 'dinner club'; }
  }, 'sub-fill');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Create sub/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'sub');
  await sleep(2400);
  mark('subscriptions');
  await sleep(3400);

  // ---- 9. Webhooks add + test ----
  await safeEval(page, () => {
    const w = document.getElementById('whUrl'); if (w) { w.value = 'https://demo.humanpay.app/hook'; }
  }, 'wh-fill');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Add webhook/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'wh-add');
  await sleep(1800);
  mark('webhooks');
  await sleep(2800);

  // ---- 10. FX quote ----
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Get quote/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'fx');
  await sleep(2400);
  mark('fx');
  await sleep(2800);

  // ---- 11. Independence on-chain probe ----
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Check counterparties/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'indep');
  await sleep(3200);
  mark('independence');
  await sleep(2800);

  // ---- 12. Outputs: /attribution + /proof ----
  await safeGoto(page, URL + '/attribution', 'attribution');
  await sleep(2600);
  mark('attribution');
  await sleep(3400);
  await safeGoto(page, URL + '/proof', 'proof');
  await sleep(2600);
  mark('proof');
  await sleep(3600);

  // ---- 13. Closure: landing ----
  await safeGoto(page, URL + '/', 'close-landing');
  await sleep(2200);
  await safeWheel(page, 300, "w");
  await sleep(1000);
  mark('close');
  await sleep(3000);

  await browser.close();
  mark('done');
  console.log('TAKE2 COMPLETE');
})().catch((e) => { console.error('DRIVER FAILED', e); process.exit(1); });