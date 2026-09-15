// HumanPay live demo driver — walks the DEPLOYED app, real clicks, real data.
// Phase marks written to timeline.json for narration sync.
const puppeteer = require('puppeteer');
const fs = require('fs');

const URL = 'https://humanpay.onrender.com';
const CHROME = '/home/ubuntu/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome';
const timeline = [];
const mark = (phase) => { timeline.push({ phase, t: Date.now() / 1000 }); fs.writeFileSync('demo/timeline.json', JSON.stringify(timeline)); console.log(`[mark] ${phase}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retrying safe-eval helper for SPA re-renders
async function safeEval(page, fn, label, retries = 8) {
  for (let i = 0; i < retries; i++) {
    try { return await page.evaluate(fn); } catch (e) { if (!/detached Frame/i.test(String(e.message))) throw e; await sleep(250); }
  }
  throw new Error('safeEval gave up: ' + label);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--window-position=0,0', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ---- 1. Landing ----
  await page.goto(URL + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  mark('landing_hero');
  await sleep(3000);
  await page.mouse.wheel({ deltaY: 900 });
  await sleep(2500);
  mark('landing_sections');
  await sleep(2500);

  // ---- 2. Product app, read-only ----
  await page.goto(URL + '/app', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000); // veil auto-shows
  mark('app_veil');
  await sleep(2000);
  // click "Explore read-only"
  const roClicked = await safeEval(page, () => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => /read-?only/i.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  }, 'readonly');
  await sleep(1500);
  mark('app_readonly');
  await sleep(4000); // rails load

  // ---- 3. Rail status panel (LIVE settle, honest Self MOCK) ----
  await safeEval(page, async () => { const el = document.getElementById('rail-title') || document.querySelector('.card .t'); window.__scrolldone = true; }, 'rail');
  mark('rails_panel');
  await sleep(4000);

  // ---- 4. Send a tip form + drain-test (anti-drain block) ----
  await page.mouse.wheel({ deltaY: 400 });
  await sleep(1500);
  mark('tip_form');
  await sleep(2500);
  // run a drain-test (over-cap block) — real policy response
  await safeEval(page, async () => {
    const amt = document.getElementById('amount'); if (amt) { amt.value = '999999999'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
    const to = document.getElementById('payTo'); if (to) { to.value = '0x' + 'd'.repeat(40); }
  }, 'drain-fill');
  const btnDraw = await safeEval(page, () => {
    const b = [...document.querySelectorAll('button')].find((x) => /drain-test/i.test(x.textContent));
    if (b) { b.click(); return true; } return false;
  }, 'drain-click');
  await sleep(2500);
  mark('drain_block');

  // ---- 5. Receipts + CSV ----
  await page.mouse.wheel({ deltaY: 400 });
  await sleep(2000);
  mark('receipts');
  await sleep(3000);

  // ---- 6. Pay link ----
  await page.mouse.wheel({ deltaY: 900 });
  await sleep(2500);
  mark('tools_paylink');
  await sleep(2500);

  // ---- 7. Split-a-bill create ----
  await safeEval(page, () => {
    const t = document.getElementById('billTitle'); if (t) { t.value = 'Team dinner'; t.dispatchEvent(new Event('input', { bubbles: true })); }
    const tot = document.getElementById('billTotal'); if (tot) { tot.value = '36'; }
    const r = document.getElementById('billRecipients'); if (r) { r.value = '@zubby, @peer1'; }
  }, 'bill-fill');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Create bill/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'bill-click');
  await sleep(2500);
  mark('split_bill');
  await sleep(2500);

  // ---- 8. Subscriptions ----
  await safeEval(page, () => {
    const p = document.getElementById('subPayee'); if (p) { p.value = '@peer1'; }
    const a = document.getElementById('subAmt'); if (a) { a.value = '5'; }
    const iv = document.getElementById('subIv'); if (iv) { iv.value = '3600'; }
    const l = document.getElementById('subLabel'); if (l) { l.value = 'coffee fund'; }
  }, 'sub-fill');
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Create sub/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'sub-click');
  await sleep(2000);
  mark('subscriptions');
  await sleep(3000);

  // ---- 9. FX quote ----
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Get quote/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'fx-click');
  await sleep(2200);
  mark('fx_quote');
  await sleep(2500);

  // ---- 10. Independence check (on-chain probe) ----
  await safeEval(page, () => { const b = [...document.querySelectorAll('button')].find((x) => /Check counterparties/i.test(x.textContent)); if (b) { b.click(); return true; } return false; }, 'indep-click');
  await sleep(3000);
  mark('independence');
  await sleep(2500);

  // ---- 11. Open /attribution + /proof in a new tab-free nav ----
  await page.goto(URL + '/attribution', { waitUntil: 'networkidle2' });
  await sleep(2500);
  mark('attribution_json');
  await sleep(3000);
  await page.goto(URL + '/proof', { waitUntil: 'networkidle2' });
  await sleep(2500);
  mark('proof_json');
  await sleep(3000);

  // ---- 12. Final landing close ----
  await page.goto(URL + '/', { waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.mouse.wheel({ deltaY: 200 });
  await sleep(1000);
  mark('close');
  await sleep(2500);

  await browser.close();
  mark('done');
  console.log('TAKE COMPLETE');
})().catch((e) => { console.error('DRIVER FAILED', e); process.exit(1); });