'use strict';

/**
 * Prevents duplicate threads by tracking which article URLs have been used.
 * Stored in data/posted_articles.json as a rolling array (max 500 entries).
 */

const cache = require('./cache');
const logger = require('./logger');

const POSTED_FILE = 'posted_articles.json';
const MAX_ENTRIES = 500;

function getPostedArticles() {
  const data = cache.readJSON(POSTED_FILE);
  if (!data) return [];
  // Support both plain URL arrays (legacy) and object arrays
  return Array.isArray(data) ? data : [];
}

function savePostedArticles(articles) {
  // Rolling window: keep only the most recent MAX_ENTRIES
  const trimmed = articles.slice(-MAX_ENTRIES);
  cache.writeJSON(POSTED_FILE, trimmed);
}

/**
 * Return only articles whose URL has not been posted before.
 * @param {Array<{url: string}>} articles
 * @returns {Array<{url: string}>}
 */
function filterNewArticles(articles) {
  const posted = getPostedArticles();
  const postedUrls = new Set(posted.map((a) => (typeof a === 'string' ? a : a.url)));

  const fresh = articles.filter((a) => a.url && !postedUrls.has(a.url));
  logger.info(`Deduplication: ${articles.length} total → ${fresh.length} new`);
  return fresh;
}

/**
 * Record article URLs so they are not posted again.
 * @param {Array<{url: string, title: string}>} articles
 */
function markArticlesAsPosted(articles) {
  const posted = getPostedArticles();
  const newEntries = articles.map((a) => ({
    url: a.url,
    title: a.title,
    postedAt: new Date().toISOString(),
  }));
  savePostedArticles([...posted, ...newEntries]);
  logger.info(`Marked ${newEntries.length} article(s) as posted`);
}

module.exports = { filterNewArticles, markArticlesAsPosted, getPostedArticles };
