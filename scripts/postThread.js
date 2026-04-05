'use strict';

/**
 * Posting orchestrator.
 *
 * Strategy:
 *   1. Try Twitter API v2 (fast, clean, no browser needed).
 *   2. If the API throws, automatically fall back to Puppeteer.
 *   3. If both fail, throw so the run is marked as failed.
 *
 * Can be forced to use Puppeteer by setting FORCE_PUPPETEER=true.
 * Can be run in dry-run mode (no posts) by setting DRY_RUN=true.
 * Can be run standalone: node scripts/postThread.js
 */

require('dotenv').config();

const twitterApi = require('../services/twitterApiService');
const puppeteerService = require('../services/puppeteerService');
const logger = require('../utils/logger');

const DRY_RUN = process.env.DRY_RUN === 'true';
const FORCE_PUPPETEER = process.env.FORCE_PUPPETEER === 'true';

/**
 * Post a thread with automatic fallback.
 *
 * @param {string[]} tweets
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ method: string, tweets: Array }>}
 */
async function postThreadWithFallback(tweets, { dryRun = DRY_RUN } = {}) {
  if (!tweets || tweets.length === 0) throw new Error('No tweets to post');

  if (dryRun) {
    logger.info('[DRY RUN] Thread preview (nothing will be posted):');
    tweets.forEach((t, i) =>
      logger.info(`  [${i + 1}/${tweets.length}] (${t.length} chars) ${t}`)
    );
    return {
      method: 'dry-run',
      tweets: tweets.map((t, i) => ({ id: `dry-run-${i}`, text: t })),
    };
  }

  // ── Primary: Twitter API ──────────────────────────────────────────────────
  if (!FORCE_PUPPETEER) {
    try {
      logger.info('Posting via Twitter API v2…');
      const posted = await twitterApi.postThread(tweets);
      logger.info('Thread posted via Twitter API');
      return { method: 'twitter-api', tweets: posted };
    } catch (apiErr) {
      logger.warn(`Twitter API failed: ${apiErr.message}. Switching to Puppeteer fallback…`);
    }
  } else {
    logger.info('FORCE_PUPPETEER=true — skipping Twitter API');
  }

  // ── Fallback: Puppeteer ───────────────────────────────────────────────────
  try {
    logger.info('Posting via Puppeteer fallback…');
    const posted = await puppeteerService.postThread(tweets);
    logger.info('Thread posted via Puppeteer');
    return { method: 'puppeteer', tweets: posted };
  } catch (puppeteerErr) {
    logger.error(`Puppeteer fallback also failed: ${puppeteerErr.message}`);
    throw new Error(
      `All posting methods exhausted. Last error: ${puppeteerErr.message}`
    );
  }
}

module.exports = { postThreadWithFallback };

// ── Standalone test runner ────────────────────────────────────────────────────

if (require.main === module) {
  // A realistic sample thread to test posting logic end-to-end
  const sampleTweets = [
    '1/5 Three AI model releases, one infrastructure shift, and a major acquisition happened in tech this week. Here is what matters.',
    '2/5 Anthropic released Claude 3.5 with a 200K context window. For developers, this means entire codebases can fit in a single prompt without chunking strategies.',
    '3/5 Google cut inference costs by 40% on Gemini Flash. Cheaper inference directly reduces the burn rate for any startup building on top of hosted models.',
    '4/5 Meta open-sourced its next-generation multimodal model. Developers now have a production-grade vision+text model they can run on their own infra — no vendor lock-in.',
    '5/5 The pattern: AI is becoming commodity infrastructure. Differentiation is shifting from model quality to speed, cost, and data pipelines. Follow for daily tech threads.',
  ];

  postThreadWithFallback(sampleTweets)
    .then((result) => {
      console.log(`\nPosted via: ${result.method}`);
      result.tweets.forEach((t) => console.log(` - ${t.id}: ${t.text?.substring(0, 60)}`));
    })
    .catch((err) => {
      console.error('FATAL:', err.message);
      process.exit(1);
    });
}
