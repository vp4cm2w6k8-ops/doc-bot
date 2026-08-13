/**
 * Dragons of Camelot - Render Node.js Bot Core
 */
const puppeteer = require('puppeteer');

// Config and State
const POLL_INTERVAL_MS = 5000;
let pendingBuilds = [
  // Example queued targets:
  // { location: 'Water', name: 'Camp', targetLevel: 10 }
];

/**
 * Browser-side function to scrape the DOM.
 * Executed inside Puppeteer's page context.
 */
function scrapeActiveConstructionQueue() {
  const container = document.querySelector('.constructionItemList');
  if (!container) return [];

  const items = container.querySelectorAll('.constructionItem');
  const activeQueue = [];

  items.forEach((item) => {
    const nameEl = item.querySelector('.itemName');
    const quantityEl = item.querySelector('.itemQuantity');
    const timerEl = item.querySelector('#timer');
    const locationEl = item.querySelector('.buildTimerLocation');
    const speedUpEl = item.querySelector('.speedUpIcon');
    const progressBar = item.querySelector('#time-left');

    let rawTimeText = '';
    if (timerEl) {
      const clone = timerEl.cloneNode(true);
      const locSpan = clone.querySelector('.buildTimerLocation');
      if (locSpan) locSpan.remove();
      rawTimeText = clone.textContent.replace(/Time Left:\s*/i, '').trim();
    }

    activeQueue.push({
      name: nameEl ? nameEl.textContent.trim() : 'Unknown',
      level: quantityEl ? parseInt(quantityEl.textContent.trim(), 10) : 0,
      location: locationEl ? locationEl.textContent.trim() : 'Main',
      timeLeft: rawTimeText,
      speedUpType: speedUpEl ? speedUpEl.getAttribute('data-speedup-type') : null,
      progressPercent: progressBar ? parseFloat(progressBar.style.width) : 0
    });
  });

  return activeQueue;
}

/**
 * Checks if a specific location is currently building
 */
function isCityBusy(activeQueue, locationName) {
  return activeQueue.some(
    (item) => item.location.toLowerCase() === locationName.toLowerCase()
  );
}

/**
 * Main Puppeteer Bot Runner
 */
async function startBot() {
  console.log('[BOT] Launching headless browser...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for Render environments
  });

  const page = await browser.newPage();

  // 1. Navigate and Hook Game Context
  console.log('[BOT] Navigating to game...');
  await page.goto('https://www.dragonsofcamelot.com/Great.html', { waitUntil: 'networkidle2' });

  // 2. Queue Engine Polling Loop
  setInterval(async () => {
    try {
      // Evaluate DOM scraper directly inside browser page
      const activeQueue = await page.evaluate(scrapeActiveConstructionQueue);
      console.log(`[BOT] Active jobs running: ${activeQueue.length}`, activeQueue);

      // Process pending queue against active busy cities
      for (let i = pendingBuilds.length - 1; i >= 0; i--) {
        const task = pendingBuilds[i];

        if (!isCityBusy(activeQueue, task.location)) {
          console.log(`[BOT] Open slot detected in ${task.location}! Dispatching build: ${task.name}`);
          
          // Execute trigger in page context if slot open
          await page.evaluate((buildTask) => {
            console.log(`[Browser Context] Starting build for ${buildTask.name} in ${buildTask.location}`);
            // Fire in-game build click or API call here
          }, task);

          // Remove completed task assignment
          pendingBuilds.splice(i, 1);
        } else {
          console.log(`[BOT] ${task.location} is busy. Waiting...`);
        }
      }
    } catch (err) {
      console.error('[BOT] Error during queue polling cycle:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

// Start Node.js service
startBot().catch((err) => {
  console.error('[BOT] Fatal startup error:', err);
  process.exit(1);
});
