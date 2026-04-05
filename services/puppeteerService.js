'use strict';

/**
 * Puppeteer-based Twitter posting fallback.
 *
 * Used automatically when the Twitter API v2 call fails (rate limit, suspended
 * keys, etc.).  Logs in with username + password, then posts each tweet in the
 * thread as a reply chain via the web UI.
 *
 * Cookie persistence reduces full logins to once per session.
 *
 * NOTE: This approach can break if Twitter changes its DOM.  Update selectors
 * in SELECTORS below if tweets stop being detected.
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Apply stealth patches — bypasses Twitter's headless browser detection
puppeteerExtra.use(StealthPlugin());

// ── Config ────────────────────────────────────────────────────────────────────

const COOKIES_PATH = path.join(__dirname, '..', 'data', 'twitter_cookies.json');
const NAV_TIMEOUT = 30_000;
const TWEET_DELAY_MS = 3_500;   // pause between each tweet post
const TYPE_DELAY_MS = 40;       // simulate human typing speed

/**
 * CSS selectors for Twitter's web UI.
 * Update these if the automation breaks after a Twitter UI change.
 */
const SELECTORS = {
  usernameInput: 'input[autocomplete="username"]',
  emailVerify: 'input[data-testid="ocfEnterTextTextInput"]',
  passwordInput: 'input[name="password"]',
  tweetComposer: '[data-testid="tweetTextarea_0"]',
  tweetSubmit: '[data-testid="tweetButton"]',
  replyButton: '[data-testid="reply"]',
  sidebarCompose: '[data-testid="SideNav_NewTweet_Button"]',
};

// ── Browser helpers ───────────────────────────────────────────────────────────

async function launchBrowser() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  return puppeteerExtra.launch({
    headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Cookie persistence ────────────────────────────────────────────────────────

async function saveCookies(page) {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    logger.info('Session cookies saved');
  } catch (err) {
    logger.warn('Failed to save cookies', { error: err.message });
  }
}

function normalizeCookies(raw) {
  // Convert browser-extension export format to Puppeteer's expected format
  const sameSiteMap = { no_restriction: 'None', lax: 'Lax', strict: 'Strict' };
  return raw.map((c) => {
    const cookie = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
    };
    // expirationDate (browser) → expires (Puppeteer)
    if (c.expirationDate) cookie.expires = Math.floor(c.expirationDate);
    // sameSite mapping
    if (c.sameSite) {
      cookie.sameSite = sameSiteMap[c.sameSite.toLowerCase()] || 'None';
    }
    return cookie;
  });
}

async function loadCookies(page) {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) return false;
    const cookies = normalizeCookies(raw);
    await page.setCookie(...cookies);
    logger.info(`Loaded ${cookies.length} cookies`);
    return true;
  } catch (err) {
    logger.warn('Failed to load cookies', { error: err.message });
    return false;
  }
}

async function isLoggedIn(page) {
  try {
    await page.goto('https://x.com/home', {
      waitUntil: 'networkidle2',
      timeout: NAV_TIMEOUT,
    });
    const url = page.url();
    const loggedIn = url.includes('/home') && !url.includes('/login') && !url.includes('/i/flow');
    logger.info(`Session check: ${loggedIn ? 'active' : 'expired'}`);
    return loggedIn;
  } catch (err) {
    logger.warn('isLoggedIn check failed', { error: err.message });
    return false;
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(page) {
  const { TWITTER_USERNAME, TWITTER_PASSWORD, TWITTER_EMAIL } = process.env;

  if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
    throw new Error('TWITTER_USERNAME and TWITTER_PASSWORD are required for Puppeteer fallback');
  }

  logger.info('Logging in to Twitter via Puppeteer');
  await page.goto('https://x.com/i/flow/login', {
    waitUntil: 'networkidle2',
    timeout: NAV_TIMEOUT,
  });
  await sleep(3_000);

  // Screenshot step 1: login page loaded
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'step1_login_page.png') });

  // Step 1: Enter username
  await page.waitForSelector(SELECTORS.usernameInput, { timeout: 15_000 });
  await page.click(SELECTORS.usernameInput);
  await sleep(500);
  await page.type(SELECTORS.usernameInput, TWITTER_USERNAME, { delay: TYPE_DELAY_MS });
  await sleep(800);

  // Screenshot step 2: after typing username
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'step2_username_typed.png') });

  // Use keyboard Enter to advance — more reliable than clicking a button
  await page.keyboard.press('Enter');
  await sleep(3_500);

  // Screenshot step 3: after username submitted
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'step3_after_username.png') });

  const afterUserUrl = page.url();
  logger.info(`After username step: ${afterUserUrl}`);

  // Step 2a: Handle phone/username verification challenge
  const phoneChallenge = await page.$('input[data-testid="ocfEnterTextTextInput"]');
  if (phoneChallenge) {
    logger.info('Phone/email verification challenge detected');
    if (!TWITTER_EMAIL) {
      throw new Error('Twitter is asking for verification but TWITTER_EMAIL is not set');
    }
    await phoneChallenge.click();
    await phoneChallenge.type(TWITTER_EMAIL, { delay: TYPE_DELAY_MS });
    await page.keyboard.press('Enter');
    await sleep(3_000);
  }

  // Step 2b: Handle email-only challenge (different selector)
  const emailChallenge = await page.$(SELECTORS.emailVerify);
  if (emailChallenge) {
    logger.info('Email verification step detected');
    if (!TWITTER_EMAIL) {
      throw new Error('Twitter is asking for email verification but TWITTER_EMAIL is not set');
    }
    await emailChallenge.click();
    await emailChallenge.type(TWITTER_EMAIL, { delay: TYPE_DELAY_MS });
    await page.keyboard.press('Enter');
    await sleep(3_000);
  }

  // Step 3: Enter password — wait longer and check what's on screen
  logger.info('Waiting for password field…');
  try {
    await page.waitForSelector(SELECTORS.passwordInput, { timeout: 15_000 });
  } catch (err) {
    // Screenshot to data dir for diagnosis
    const screenshotPath = require('path').join(__dirname, '..', 'data', 'login_debug.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const pageUrl = page.url();
    const pageTitle = await page.title();
    throw new Error(
      `Password field not found. URL: ${pageUrl}, Title: ${pageTitle}. ` +
      `Screenshot saved to data/login_debug.png — check what Twitter is showing.`
    );
  }

  await page.click(SELECTORS.passwordInput);
  await sleep(300);
  await page.type(SELECTORS.passwordInput, TWITTER_PASSWORD, { delay: TYPE_DELAY_MS });
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(5_000);

  // Confirm login succeeded
  const url = page.url();
  if (url.includes('/login') || url.includes('/i/flow')) {
    const screenshotPath = require('path').join(__dirname, '..', 'data', 'login_debug.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    throw new Error('Puppeteer login failed — still on login page. Screenshot saved to data/login_debug.png');
  }

  logger.info('Puppeteer login successful');
  await saveCookies(page);
}

// ── Tweet composition ─────────────────────────────────────────────────────────

/**
 * Open the tweet composer (new tweet or reply) and type the text.
 * @param {import('puppeteer').Page} page
 * @param {string} text
 * @param {string|null} replyToUrl  full URL of the tweet to reply to
 */
async function openComposerAndType(page, text, replyToUrl) {
  if (replyToUrl) {
    await page.goto(replyToUrl, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    await sleep(2_000);

    const replyBtn = await page.$(SELECTORS.replyButton);
    if (!replyBtn) throw new Error('Reply button not found on tweet page');
    await replyBtn.click();
    await sleep(1_500);
  } else {
    await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    await sleep(2_000);

    // The "compose" area is usually rendered inline on /home
    // If not, click the sidebar compose button
    const inlineComposer = await page.$(SELECTORS.tweetComposer);
    if (!inlineComposer) {
      const sidebarBtn = await page.$(SELECTORS.sidebarCompose);
      if (!sidebarBtn) throw new Error('Could not find tweet compose area');
      await sidebarBtn.click();
      await sleep(1_500);
    }
  }

  // Wait for the editor to be ready and type
  await page.waitForSelector(SELECTORS.tweetComposer, { timeout: 10_000 });
  await page.click(SELECTORS.tweetComposer);
  await page.keyboard.type(text, { delay: TYPE_DELAY_MS });
  await sleep(800);
}

/**
 * Submit the tweet that is currently open in the composer.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<string|null>} URL of the posted tweet, or null
 */
async function submitTweet(page) {
  // Screenshot before submit for debugging
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'before_submit.png') });

  // Try multiple selectors — X changes these occasionally
  const submitSelectors = [
    '[data-testid="tweetButton"]',
    '[data-testid="tweetButtonInline"]',
    'button[data-testid="tweetButton"]',
    'div[data-testid="tweetButton"]',
  ];

  let submitBtn = null;
  for (const sel of submitSelectors) {
    submitBtn = await page.$(sel);
    if (submitBtn) { logger.info(`Submit button found: ${sel}`); break; }
  }

  if (!submitBtn) {
    await page.screenshot({ path: path.join(__dirname, '..', 'data', 'submit_not_found.png') });
    throw new Error('Tweet submit button not found');
  }

  await submitBtn.click();
  await sleep(3_500);

  // Try to capture the URL of the newly posted tweet
  const currentUrl = page.url();
  if (currentUrl.match(/\/status\/\d+/)) return currentUrl;

  // Fallback: look for a status link in the DOM
  try {
    const links = await page.$$eval(
      '[data-testid="tweet"] a[href*="/status/"]',
      (els) => els.map((el) => el.href)
    );
    if (links.length > 0) return links[0];
  } catch (_) {
    // Non-fatal
  }

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Post a full thread via Puppeteer browser automation.
 * Handles login (with cookie reuse), first tweet, and reply chain.
 *
 * @param {string[]} tweets
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<Array<{id: string, url: string|null, text: string}>>}
 */
async function postThread(tweets, { dryRun = false } = {}) {
  if (!tweets || tweets.length === 0) throw new Error('postThread: no tweets provided');

  if (dryRun) {
    logger.info('[DRY RUN] Puppeteer — would post:');
    tweets.forEach((t, i) => logger.info(`  [${i + 1}] ${t}`));
    return tweets.map((t, i) => ({ id: `dry-run-puppeteer-${i}`, url: null, text: t }));
  }

  logger.info(`Posting thread of ${tweets.length} tweet(s) via Puppeteer`);

  const browser = await launchBrowser();
  const posted = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Attempt cookie-based session; fall back to full login
    const hasCookies = await loadCookies(page);
    if (!hasCookies || !(await isLoggedIn(page))) {
      await login(page);
    }

    let lastTweetUrl = null;

    for (let i = 0; i < tweets.length; i++) {
      logger.info(`Composing tweet ${i + 1}/${tweets.length} via Puppeteer`);
      await sleep(TWEET_DELAY_MS);

      await openComposerAndType(page, tweets[i], lastTweetUrl);
      const url = await submitTweet(page);
      lastTweetUrl = url;

      posted.push({ id: `puppeteer-${i + 1}`, url, text: tweets[i] });
      logger.info(`Tweet ${i + 1} posted`, { url });
    }

    logger.info(`Puppeteer thread complete (${posted.length} tweets)`);
    return posted;
  } finally {
    await browser.close();
  }
}

module.exports = { postThread };
