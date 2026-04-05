'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LOGS_DIR = path.join(__dirname, '..', 'data', 'logs');

// Ensure logs directory exists before creating file transports
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const todayStamp = new Date().toISOString().split('T')[0];

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: false, level: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? `  ${JSON.stringify(meta)}`
      : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, `run-${todayStamp}.log`),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5 MB per file
      maxFiles: 7,              // keep one week of logs
    }),
  ],
});

module.exports = logger;
