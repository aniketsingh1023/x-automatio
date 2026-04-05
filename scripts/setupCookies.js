'use strict';

/**
 * One-time cookie setup script.
 * Opens a real visible browser window so you can log in to X manually.
 * Cookies are saved automatically after login — future runs skip login entirely.
 *
 * Run once: node scripts/setupCookies.js
 */

require('dotenv').config();

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

puppeteerExtra.use(StealthPlugin());

const COOKIES_PATH = path.join(__dirname, '..', 'data', 'twitter_cookies.json');

async function setup() {
  console.log('\n=== X-Automatio Cookie Setup ===\n');
  console.log('A browser window will open. Log in to X.com normally.');
  console.log('After you are fully logged in and see your home feed,');
  console.log('come back here and press ENTER to save cookies and close.\n');

  const browser = await puppeteerExtra.launch({
    headless: false, // visible window — you control it
    defaultViewport: null, // use full window size
    args: ['--start-maximized'],
  });

  const page = await browser.newPage();
  await page.goto('https://x.com/login', { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for user to log in manually
  await new Promise((resolve) => {
    process.stdout.write('Press ENTER once you are logged in and see your home feed... ');
    process.stdin.once('data', resolve);
  });

  // Save cookies
  const cookies = await page.cookies();
  if (!fs.existsSync(path.dirname(COOKIES_PATH))) {
    fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true });
  }
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));

  console.log(`\nCookies saved to: ${COOKIES_PATH}`);
  console.log(`Saved ${cookies.length} cookies.`);

  await browser.close();
  console.log('\nSetup complete. You can now run: node scripts/main.js\n');
}

setup().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
