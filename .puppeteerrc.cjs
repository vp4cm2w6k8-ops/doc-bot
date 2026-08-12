const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Directs Puppeteer to store Chrome inside the project source directory
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
