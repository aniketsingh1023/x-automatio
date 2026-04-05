'use strict';

/**
 * Twitter API v2 posting service.
 * Uses OAuth 1.0a (User Context) to post tweets and build reply chains.
 * Required app permissions: Read and Write.
 */

const { TwitterApi } = require('twitter-api-v2');
const logger = require('../utils/logger');

// Minimum delay between tweets in a thread to avoid rate-limit bursts
const INTER_TWEET_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build an authenticated TwitterApi client from environment variables.
 * Throws clearly if any required variable is missing.
 */
function buildClient() {
  const required = [
    'TWITTER_APP_KEY',
    'TWITTER_APP_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_SECRET',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing Twitter API credentials: ${missing.join(', ')}`);
  }

  return new TwitterApi({
    appKey: process.env.TWITTER_APP_KEY,
    appSecret: process.env.TWITTER_APP_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });
}

/**
 * Post a single tweet, optionally as a reply.
 * @param {import('twitter-api-v2').TwitterApiv2} v2  the v2 client
 * @param {string} text
 * @param {string|null} replyToId  tweet ID to reply to
 * @returns {Promise<{id: string, text: string}>}
 */
async function postOneTweet(v2, text, replyToId = null) {
  const payload = { text };
  if (replyToId) {
    payload.reply = { in_reply_to_tweet_id: replyToId };
  }

  const response = await v2.tweet(payload);
  return response.data; // { id, text }
}

/**
 * Post an entire thread via the Twitter API.
 * Each tweet (after the first) is posted as a reply to the previous one.
 *
 * @param {string[]} tweets
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<Array<{id: string, text: string}>>}
 */
async function postThread(tweets, { dryRun = false } = {}) {
  if (!tweets || tweets.length === 0) throw new Error('postThread: no tweets provided');

  if (dryRun) {
    logger.info('[DRY RUN] Twitter API — would post:');
    tweets.forEach((t, i) => logger.info(`  [${i + 1}] ${t}`));
    return tweets.map((t, i) => ({ id: `dry-run-api-${i}`, text: t }));
  }

  const client = buildClient();
  const v2 = client.v2;
  const posted = [];
  let lastId = null;

  for (let i = 0; i < tweets.length; i++) {
    try {
      logger.info(`Posting tweet ${i + 1}/${tweets.length} via API`);
      const data = await postOneTweet(v2, tweets[i], lastId);
      posted.push(data);
      lastId = data.id;
      logger.info(`  Posted tweet ${i + 1}`, { id: data.id });

      if (i < tweets.length - 1) await sleep(INTER_TWEET_DELAY_MS);
    } catch (err) {
      // Handle rate-limit (429) with one automatic retry after 60 s
      if (err.code === 429) {
        logger.warn(`Rate limited on tweet ${i + 1}. Waiting 60s before retry…`);
        await sleep(60_000);
        const data = await postOneTweet(v2, tweets[i], lastId);
        posted.push(data);
        lastId = data.id;
        logger.info(`  Posted tweet ${i + 1} after rate-limit wait`, { id: data.id });
        if (i < tweets.length - 1) await sleep(INTER_TWEET_DELAY_MS);
      } else {
        // Re-throw anything else
        throw err;
      }
    }
  }

  logger.info(`Thread posted via Twitter API (${posted.length} tweets)`);
  return posted;
}

/**
 * Verify that the stored credentials are valid.
 * Useful for a quick smoke-test before the run.
 * @returns {Promise<boolean>}
 */
async function verifyCredentials() {
  try {
    const client = buildClient();
    const { data } = await client.v2.me();
    logger.info('Twitter credentials OK', { username: data.username });
    return true;
  } catch (err) {
    logger.error('Twitter credential check failed', { error: err.message });
    return false;
  }
}

module.exports = { postThread, verifyCredentials };
