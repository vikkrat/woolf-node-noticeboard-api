// Optional documentation tooling: requires Playwright and an installed browser.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');

/** Escape saved JSON before embedding it in the static evidence viewer. */
function escapeHtml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

/** Capture the actual Swagger UI plus clearly labeled views of real HTTP evidence. */
async function capture() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CAPTURE_BROWSER_CHANNEL ? { channel: process.env.CAPTURE_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1.5 });
    await page.goto('http://127.0.0.1:3000/api-docs/', { waitUntil: 'networkidle' });
    await page.locator('.opblock').first().waitFor();
    await page.screenshot({ path: 'screenshots/01-api-docs.png', fullPage: true });
    const titles = { '02-authentication': 'Create an account. Access your profile.', '03-announcements': 'Publish and discover announcements.', '04-ownership': 'Editing belongs to the author.', '05-token-lifecycle': 'Rotate once. Revoke on logout.' };
    for (const [name, title] of Object.entries(titles)) {
      const records = JSON.parse(await fs.readFile(`screenshots/${name}.json`, 'utf8'));
      // Registration is shown in its own panel; ownership focuses on the two access-denied checks and owner edit.
      const visible = name === '04-ownership' ? records.slice(1) : records;
      await page.setContent(`<html><style>body{margin:0;background:#0d1725;color:#dce7f5;padding:40px;font:15px/1.5 Consolas,monospace}h1{font:600 30px system-ui;color:#f6f8fc}header{color:#71dfc2;font:700 14px system-ui;letter-spacing:2px}section{background:#142337;border:1px solid #2c435d;border-radius:12px;margin:20px 0;padding:22px}h2{font-size:16px;color:#8ddbd2;margin:0 0 14px}pre{white-space:pre-wrap;margin:0}footer{color:#9cacc2}</style><header>NOTICEBOARD API / HTTP EVIDENCE</header><h1>${title}</h1>${visible.map(record => `<section><h2>${record.status} · ${escapeHtml(record.request)}</h2><pre>${escapeHtml(record.response === null ? '(no response body)' : JSON.stringify(record.response, null, 2))}</pre></section>`).join('')}<footer>Real local HTTP responses · credentials redacted · browser-rendered evidence</footer></html>`);
      await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
    }
    console.log('Captured Swagger UI and four HTTP evidence images.');
  } finally { await browser.close(); }
}

capture().catch(error => { console.error(error); process.exitCode = 1; });
