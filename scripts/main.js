'use strict';

/**
 * Main orchestrator — wires every stage together.
 *
 * Stages:
 *   1. Fetch top tech articles from RSS feeds
 *   2. Generate a Twitter thread via Gemini
 *   3. Post thread via Twitter API (Puppeteer fallback on failure)
 *   4. Persist posted article URLs to prevent duplicates
 *   5. Record run result in data/run_history.json
 *
 * Exit codes:
 *   0  — success
 *   1  — unrecoverable error
 */

require('dotenv').config();

const logger = require('../utils/logger');
const cache = require('../utils/cache');
const { fetchTopArticles } = require('./fetchNews');
const { generateTwitterThread } = require('./generateThread');
const { postThreadWithFallback } = require('./postThread');
const { markArticlesAsPosted } = require('../utils/deduplication');

const RUN_HISTORY_FILE = 'run_history.json';
const MAX_HISTORY_ENTRIES = 30;

// ── Run history ───────────────────────────────────────────────────────────────

function recordRun(entry) {
  const history = cache.readJSON(RUN_HISTORY_FILE) || [];
  history.push({ timestamp: new Date().toISOString(), ...entry });
  cache.writeJSON(RUN_HISTORY_FILE, history.slice(-MAX_HISTORY_ENTRIES));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();

  logger.info('══════════════════════════════════════════');
  logger.info('  X-Automatio — Daily Thread Run Started  ');
  logger.info('══════════════════════════════════════════');
  logger.info(`Timestamp : ${new Date().toISOString()}`);
  logger.info(`Mode      : ${process.env.DRY_RUN === 'true' ? 'DRY RUN' : 'LIVE'}`);
  logger.info(`Puppeteer : ${process.env.FORCE_PUPPETEER === 'true' ? 'forced' : 'fallback only'}`);

  let articles = [];
  let tweets = [];

  try {
    // ── Stage 1: Fetch ──────────────────────────────────────────────────────
    logger.info('\n[1/3] Fetching tech news…');
    articles = await fetchTopArticles();
    logger.info(`      ${articles.length} article(s) selected`);

    // ── Stage 2: Generate ───────────────────────────────────────────────────
    logger.info('\n[2/3] Generating thread with Gemini…');
    tweets = await generateTwitterThread(articles);
    logger.info(`      Tweet generated`);

    // ── Stage 3: Post ───────────────────────────────────────────────────────
    logger.info('\n[3/3] Posting thread…');
    const result = await postThreadWithFallback(tweets);
    logger.info(`      Method: ${result.method}`);

    // Only mark as posted when we actually posted (not dry-run)
    if (result.method !== 'dry-run') {
      markArticlesAsPosted(articles);
    }

    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    logger.info(`\n✓ Run completed in ${duration}s`);

    recordRun({
      status: 'success',
      method: result.method,
      articleCount: articles.length,
      tweetCount: tweets.length,
      durationSeconds: parseFloat(duration),
    });

    return 0;
  } catch (err) {
    const duration = ((Date.now() - t0) / 1000).toFixed(1);

    if (err.isSkip) {
      logger.info(`\n— Skipped: ${err.message.replace('SKIP: ', '')}`);
      recordRun({
        status: 'skipped',
        reason: err.message,
        articleCount: articles.length,
        durationSeconds: parseFloat(duration),
      });
      return 0;
    }

    logger.error(`\n✗ Run failed after ${duration}s`, {
      error: err.message,
      stack: err.stack,
    });

    recordRun({
      status: 'failed',
      error: err.message,
      articleCount: articles.length,
      tweetCount: tweets.length,
      durationSeconds: parseFloat(duration),
    });

    return 1;
  }
}

main().then((exitCode) => process.exit(exitCode));
