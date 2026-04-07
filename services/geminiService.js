'use strict';

/**
 * Google Gemini API service.
 * Uses the free-tier gemini-1.5-flash model by default.
 * Includes exponential-backoff retry logic for transient failures.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');
const { PROMPTS, THREAD_CONFIG } = require('../config/prompts');

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 70_000; // cap at 70s

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: modelName });
}

/**
 * Call the Gemini API with retry + exponential backoff.
 * @param {string} prompt
 * @returns {Promise<string>} raw text response
 */
async function callGemini(prompt) {
  const model = getModel();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Gemini API call (attempt ${attempt}/${MAX_RETRIES})`);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (!text || !text.trim()) throw new Error('Gemini returned empty response');
      logger.info(`Gemini responded (${text.length} chars)`);
      return text;
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      logger.warn(`Gemini attempt ${attempt} failed`, { error: err.message.substring(0, 120) });
      if (isLast) throw err;

      // Respect the server-suggested retryDelay if present in the 429 body
      const serverDelaySec = err.message.match(/"retryDelay":"(\d+)s"/)?.[1];
      const delay = serverDelaySec
        ? Math.min(parseInt(serverDelaySec, 10) * 1000 + 1000, MAX_RETRY_DELAY_MS)
        : Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);

      logger.info(`Retrying Gemini in ${(delay / 1000).toFixed(0)}s…`);
      await sleep(delay);
    }
  }
}

// ── Response parsing ──────────────────────────────────────────────────────────

/**
 * Extract the tweets array from Gemini's response.
 * Tries strict JSON parse first, falls back to regex extraction.
 * @param {string} responseText
 * @returns {string[]}
 */
function parseTweets(responseText) {
  // Strip markdown code fences Gemini sometimes wraps around JSON
  const cleaned = responseText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  // Strict JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.skip === true) {
      const skipErr = new Error(`SKIP: ${parsed.reason || 'nothing worth posting today'}`);
      skipErr.isSkip = true;
      throw skipErr;
    }
    if (Array.isArray(parsed.tweets) && parsed.tweets.length > 0) {
      return parsed.tweets.map(String).filter((t) => t.trim().length > 5);
    }
    throw new Error('tweets array missing or empty');
  } catch (jsonErr) {
    if (jsonErr.isSkip) throw jsonErr;
    logger.warn('JSON parse failed, trying regex fallback', { error: jsonErr.message });
  }

  // Regex fallback: extract quoted strings from a JSON-like structure
  const matches = cleaned.match(/"([^"]{20,})"/g);
  if (matches && matches.length >= THREAD_CONFIG.minTweets) {
    return matches.map((m) => m.slice(1, -1)).slice(0, THREAD_CONFIG.maxTweets);
  }

  throw new Error('Could not extract tweets from Gemini response');
}

/**
 * Clean and validate individual tweet text.
 * @param {string[]} rawTweets
 * @returns {string[]}
 */
function validateTweets(rawTweets) {
  return rawTweets
    .map((t) => {
      let s = t
        .trim()
        .replace(/^["']|["']$/g, '')     // remove wrapping quotes
        .replace(/^\d+[./]\s*/, '');      // remove leading numbering Gemini adds

      if (s.length > THREAD_CONFIG.maxTweetLength) {
        // Trim at the nearest word boundary
        s = s.substring(0, THREAD_CONFIG.maxTweetLength);
        const lastSpace = s.lastIndexOf(' ');
        if (lastSpace > 200) s = s.substring(0, lastSpace);
        s = s.replace(/[,;:]$/, '') + '...';
        logger.warn(`Tweet trimmed to ${s.length} chars`);
      }

      return s;
    })
    .filter((t) => t.length > 10);
}

/**
 * Add "N/total " numbering prefix to each tweet.
 * @param {string[]} tweets
 * @returns {string[]}
 */
function numberTweets(tweets) {
  const total = tweets.length;
  return tweets.map((t, i) => `${i + 1}/${total} ${t}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a numbered Twitter thread from a list of articles.
 * @param {Array<{title: string, description: string, source: string}>} articles
 * @returns {Promise<string[]>} ready-to-post tweet texts
 */
async function generateThread(articles) {
  if (!articles || articles.length === 0) {
    throw new Error('No articles provided to generateThread');
  }

  logger.info(`Generating thread from ${articles.length} article(s)`);

  const prompt = PROMPTS.threadGeneration.user(articles);
  const responseText = await callGemini(prompt);

  let tweets = parseTweets(responseText);
  tweets = validateTweets(tweets);

  if (tweets.length < THREAD_CONFIG.minTweets) {
    throw new Error(
      `Only ${tweets.length} tweets generated; minimum is ${THREAD_CONFIG.minTweets}`
    );
  }

  // Cap at max
  tweets = tweets.slice(0, THREAD_CONFIG.maxTweets);

  if (THREAD_CONFIG.addThreadNumbers) {
    tweets = numberTweets(tweets);
  }

  logger.info(`Thread ready: ${tweets.length} tweets`);
  return tweets;
}

/**
 * Summarize a single article into 2 sentences for use in the thread prompt.
 * Failure is non-fatal — returns the raw description truncated.
 * @param {string} title
 * @param {string} content
 * @returns {Promise<string>}
 */
async function summarizeArticle(title, content) {
  try {
    const prompt = PROMPTS.summaryGeneration.user(title, content);
    const summary = await callGemini(prompt);
    return summary.trim().substring(0, 350);
  } catch (err) {
    logger.warn('Article summarization failed, using raw description', { error: err.message });
    return content.substring(0, 250);
  }
}

module.exports = { generateThread, summarizeArticle, callGemini };
