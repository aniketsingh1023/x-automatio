'use strict';

/**
 * Configurable AI prompts and thread settings.
 * Tweak these to adjust the tone, format, and style of generated threads.
 */

const PROMPTS = {
  threadGeneration: {
    /**
     * Main prompt for generating a full Twitter thread from a list of articles.
     * @param {Array<{title: string, description: string, source: string}>} articles
     * @returns {string} prompt string
     */
    user: (articles) => `You are a tech journalist who writes viral Twitter threads for a senior developer audience.

Based on the following tech news articles, generate a Twitter thread of exactly 5-7 tweets.

ARTICLES:
${articles.map((a, i) => `${i + 1}. [${a.source}] ${a.title}\n   Summary: ${a.description}`).join('\n\n')}

THREAD REQUIREMENTS:
- Tweet 1: A strong hook that makes developers stop scrolling. State the biggest insight upfront. No clickbait.
- Tweets 2 through N-2: One key story per tweet, each ending with a "why it matters" insight for developers.
- Tweet N-1: Identify the broader trend or pattern connecting these stories.
- Tweet N: CTA asking readers to follow for daily tech threads.

WRITING RULES (STRICT):
- No emojis whatsoever
- No hashtags (they reduce algorithmic reach)
- Each tweet must be under 255 characters
- Write in plain, direct, active voice
- Lead every tweet with the most important word or number
- No filler phrases like "In conclusion" or "It is worth noting"
- Treat the reader as an expert

Respond ONLY with valid JSON in exactly this format, no markdown, no extra text:
{"tweets":["tweet text 1","tweet text 2","tweet text 3","tweet text 4","tweet text 5"]}`,
  },

  summaryGeneration: {
    /**
     * Prompt to summarize a single article into 2 tight sentences.
     * @param {string} title
     * @param {string} rawContent
     * @returns {string} prompt string
     */
    user: (title, rawContent) => `Summarize this tech article in exactly 2 sentences for use in a tweet thread. Focus on: what happened and why it matters to developers. No emojis. No filler.

Title: ${title}
Content: ${rawContent.substring(0, 800)}

Reply with ONLY the 2-sentence summary. Nothing else.`,
  },
};

const THREAD_CONFIG = {
  minTweets: 5,
  maxTweets: 7,
  // Characters reserved for the "N/7 " prefix added during numbering
  maxTweetLength: 255,
  addThreadNumbers: true,
  // e.g. "1/6 " prefix — 4 chars
  numberingPrefixLength: 4,
};

module.exports = { PROMPTS, THREAD_CONFIG };
