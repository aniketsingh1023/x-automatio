'use strict';

/**
 * RSS feed service.
 * Fetches articles from multiple tech news sources in parallel.
 * Each feed failure is isolated — one bad feed does not abort the run.
 */

const Parser = require('rss-parser');
const logger = require('../utils/logger');

const parser = new Parser({
  customFields: {
    item: ['media:content', 'content:encoded'],
  },
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TechThreadBot/1.0)',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
  },
});

/**
 * RSS feed definitions.
 * Add or remove feeds here to change coverage.
 * Each entry must have: name, url
 */
const RSS_FEEDS = [
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
  },
  {
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
  },
  {
    name: 'MIT Technology Review',
    url: 'https://www.technologyreview.com/feed/',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDescription(item) {
  const raw =
    item['content:encoded'] ||
    item.content ||
    item.contentSnippet ||
    item.description ||
    item.summary ||
    '';
  return stripHtml(raw).substring(0, 600);
}

function normalizeArticle(item, sourceName) {
  return {
    title: stripHtml(item.title || 'Untitled'),
    url: item.link || item.guid || '',
    description: extractDescription(item),
    publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
    source: sourceName,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch and normalize articles from a single RSS feed.
 * Returns an empty array on failure instead of throwing.
 * @param {{ name: string, url: string }} feed
 * @returns {Promise<Array>}
 */
async function fetchFeed(feed) {
  try {
    logger.info(`Fetching: ${feed.name}`);
    const data = await parser.parseURL(feed.url);
    const articles = data.items
      .slice(0, 10)
      .map((item) => normalizeArticle(item, feed.name))
      .filter((a) => a.url && a.title);

    logger.info(`  ${feed.name}: ${articles.length} articles`);
    return articles;
  } catch (err) {
    logger.warn(`Feed failed: ${feed.name}`, { error: err.message });
    return [];
  }
}

/**
 * Fetch all configured RSS feeds in parallel.
 * Results are merged and sorted by newest first.
 * @param {Array} [feedList]  override default feeds for testing
 * @returns {Promise<Array>}
 */
async function fetchAllFeeds(feedList = RSS_FEEDS) {
  const results = await Promise.allSettled(feedList.map((f) => fetchFeed(f)));

  const all = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled') all.push(...r.value);
  });

  // Newest first
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  // Remove exact URL duplicates that can appear across feeds
  const seen = new Set();
  const deduped = all.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  logger.info(`Total articles after merge + dedup: ${deduped.length}`);
  return deduped;
}

/**
 * Filter articles published within the last N hours.
 * @param {Array} articles
 * @param {number} [hoursBack=48]
 * @returns {Array}
 */
function filterRecentArticles(articles, hoursBack = 48) {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const recent = articles.filter((a) => new Date(a.publishedAt) >= cutoff);
  logger.info(`Recent articles (last ${hoursBack}h): ${recent.length}/${articles.length}`);
  return recent;
}

module.exports = { fetchAllFeeds, fetchFeed, filterRecentArticles, RSS_FEEDS };
