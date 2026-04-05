'use strict';

/**
 * Fetches the top N deduplicated tech articles from RSS feeds.
 * Can be run standalone for testing: node scripts/fetchNews.js
 */

require('dotenv').config();

const { fetchAllFeeds, filterRecentArticles } = require('../services/rssService');
const { filterNewArticles } = require('../utils/deduplication');
const logger = require('../utils/logger');

const TOP_COUNT = parseInt(process.env.TOP_ARTICLES_COUNT || '5', 10);
const HOURS_BACK = parseInt(process.env.HOURS_BACK || '48', 10);

/**
 * Fetch the top N fresh tech articles, deduplicated against posting history.
 * Falls back to older articles if nothing recent exists.
 * @returns {Promise<Array>} articles ready to be passed to the thread generator
 */
async function fetchTopArticles() {
  logger.info('Fetching tech news from RSS feeds…');

  const all = await fetchAllFeeds();
  if (all.length === 0) throw new Error('No articles fetched from any RSS feed');

  // Prefer recent articles; fall back gracefully to older ones
  let pool = filterRecentArticles(all, HOURS_BACK);
  if (pool.length === 0) {
    logger.warn(`No articles in last ${HOURS_BACK}h — using all fetched articles`);
    pool = all;
  }

  // Remove articles that have already been posted
  const fresh = filterNewArticles(pool);
  if (fresh.length === 0) {
    throw new Error('All available articles have already been posted. Try again later.');
  }

  const top = fresh.slice(0, TOP_COUNT);
  logger.info(`Selected ${top.length} article(s)`, {
    sources: top.map((a) => a.source),
    titles: top.map((a) => a.title.substring(0, 60)),
  });

  return top;
}

module.exports = { fetchTopArticles };

// ── Standalone test runner ────────────────────────────────────────────────────

if (require.main === module) {
  fetchTopArticles()
    .then((articles) => {
      console.log('\n=== Fetched Articles ===');
      articles.forEach((a, i) => {
        console.log(`\n${i + 1}. [${a.source}] ${a.title}`);
        console.log(`   Published: ${a.publishedAt}`);
        console.log(`   URL: ${a.url}`);
        console.log(`   Summary: ${a.description.substring(0, 120)}…`);
      });
    })
    .catch((err) => {
      console.error('FATAL:', err.message);
      process.exit(1);
    });
}
