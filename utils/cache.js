'use strict';

/**
 * Lightweight JSON file-based cache.
 * All files are stored under /data relative to the project root.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Read a JSON file from the data directory.
 * Returns null if the file does not exist or cannot be parsed.
 * @param {string} filename  e.g. "posted_articles.json"
 * @returns {any|null}
 */
function readJSON(filename) {
  ensureDataDir();
  const filepath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (err) {
    logger.error(`cache.readJSON failed for ${filename}`, { error: err.message });
    return null;
  }
}

/**
 * Write data as pretty-printed JSON to the data directory.
 * @param {string} filename
 * @param {any} data
 * @returns {boolean} success
 */
function writeJSON(filename, data) {
  ensureDataDir();
  const filepath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error(`cache.writeJSON failed for ${filename}`, { error: err.message });
    return false;
  }
}

module.exports = { readJSON, writeJSON };
