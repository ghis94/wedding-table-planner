const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('console', msg => console.log(`[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  await page.goto('http://127.0.0.1:8090/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, 'rsvp-current.png'), fullPage: false });
  await page.fill('#nom', 'Dupont');
  await page.fill('#prenom', 'Camille');
  await page.screenshot({ path: path.join(out, 'rsvp-form-current.png'), fullPage: false });
  await page.goto('http://127.0.0.1:8090/login.html', { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], #username', 'admin').catch(async () => {});
  await page.fill('input[name="password"], #password', 'changeme').catch(async () => {});
  await page.click('button[type="submit"], button').catch(async () => {});
  await page.waitForTimeout(1000);
  await page.goto('http://127.0.0.1:8090/admin.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, 'admin-current.png'), fullPage: false });
  await browser.close();
})();
