'use strict';

/**
 * BONUS: Generates a 1200×628 OG-style card for each tweet using
 * Puppeteer's screenshot API. Images are saved to data/images/.
 *
 * Reuses a single browser instance across all tweets in a run for efficiency.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');

function ensureImagesDir() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCardHtml(tweetText, index, total) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 628px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0d1117 0%, #161b22 60%, #0d1117 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #e6edf3;
  }
  .card {
    width: 1060px;
    padding: 56px 64px;
    position: relative;
    border: 1px solid #21262d;
    border-radius: 16px;
    background: rgba(22, 27, 34, 0.9);
  }
  .badge {
    display: inline-block;
    background: #1d9bf0;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    padding: 5px 14px;
    border-radius: 4px;
    margin-bottom: 28px;
  }
  .tweet-body {
    font-size: 38px;
    font-weight: 500;
    line-height: 1.45;
    color: #e6edf3;
    word-break: break-word;
  }
  .divider {
    width: 48px;
    height: 3px;
    background: #1d9bf0;
    border-radius: 2px;
    margin: 30px 0 18px;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 15px;
    color: #7d8590;
  }
  .counter {
    font-size: 13px;
    color: #484f58;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Tech Thread</span>
    <p class="tweet-body">${escapeHtml(tweetText)}</p>
    <div class="divider"></div>
    <div class="footer">
      <span>Daily Tech Threads</span>
      <span class="counter">${index} / ${total}</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render a single tweet as a PNG image.
 * @param {string} tweetText
 * @param {number} index  1-based
 * @param {number} total
 * @param {import('puppeteer').Browser} [sharedBrowser]  reuse an existing browser
 * @returns {Promise<string|null>} absolute path to the saved image, or null on failure
 */
async function generateTweetImage(tweetText, index, total, sharedBrowser = null) {
  ensureImagesDir();
  const ownBrowser = !sharedBrowser;
  let browser = sharedBrowser;

  try {
    if (ownBrowser) {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 628 });
    await page.setContent(buildCardHtml(tweetText, index, total), { waitUntil: 'load' });

    const filename = `tweet-${Date.now()}-${index}.png`;
    const filepath = path.join(IMAGES_DIR, filename);
    await page.screenshot({ path: filepath, type: 'png' });
    await page.close();

    logger.info(`Image saved: ${filename}`);
    return filepath;
  } catch (err) {
    logger.error('generateTweetImage failed', { error: err.message, index });
    return null;
  } finally {
    if (ownBrowser && browser) await browser.close();
  }
}

/**
 * Generate images for every tweet in a thread.
 * Opens one browser session for the entire batch.
 * @param {string[]} tweets
 * @returns {Promise<Array<string|null>>} array of image paths (null where failed)
 */
async function generateThreadImages(tweets) {
  let browser;
  const images = [];

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    for (let i = 0; i < tweets.length; i++) {
      const imgPath = await generateTweetImage(tweets[i], i + 1, tweets.length, browser);
      images.push(imgPath);
    }
  } catch (err) {
    logger.error('generateThreadImages failed', { error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  return images;
}

module.exports = { generateTweetImage, generateThreadImages };
