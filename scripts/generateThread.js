'use strict';

/**
 * Generates a Twitter thread from a list of articles using Gemini.
 * Uses exactly 1 API call per run — articles are passed directly with their
 * RSS descriptions. No per-article summarization to conserve free-tier quota.
 *
 * Can be run standalone for testing: node scripts/generateThread.js
 */

require('dotenv').config();

const { generateThread } = require('../services/geminiService');
const logger = require('../utils/logger');

/**
 * Generate a numbered Twitter thread from fetched articles.
 * @param {Array} articles
 * @returns {Promise<string[]>} numbered tweet texts
 */
async function generateTwitterThread(articles) {
  if (!articles || articles.length === 0) {
    throw new Error('generateTwitterThread: no articles provided');
  }

  logger.info(`Generating thread from ${articles.length} article(s) (1 API call)`);
  const tweets = await generateThread(articles);

  logger.info(`Thread ready (${tweets.length} tweets)`);
  return tweets;
}

module.exports = { generateTwitterThread };

// ── Standalone test runner ────────────────────────────────────────────────────

if (require.main === module) {
  const { fetchTopArticles } = require('./fetchNews');

  fetchTopArticles()
    .then((articles) => generateTwitterThread(articles))
    .then((tweets) => {
      console.log('\n=== Generated Thread ===');
      tweets.forEach((t, i) => {
        console.log(`\n--- Tweet ${i + 1} (${t.length} chars) ---`);
        console.log(t);
      });
    })
    .catch((err) => {
      console.error('FATAL:', err.message);
      process.exit(1);
    });
}
