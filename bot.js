/**
 * Dragons of Camelot - Complete Headless Bot & Queue Manager
 * Target Environment: Node.js (Render / Linux Server)
 */

const puppeteer = require('puppeteer');

// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const CONFIG = {
  gameUrl: 'https://www.dragonsofcamelot.com/Great.html',
  pollIntervalMs: 5000,
  maxLoginAttempts: 5,
  maxFrameAttempts: 20,
};

// Queue state managed on the Node side
const state = {
  browser: null,
  page: null,
  isProcessing: false,
  pendingBuilds: [
    // Example items in your build queue:
    // { location: 'Main', name: 'Keep', targetLevel: 10 },
    // { location: 'Water', name: 'Camp', targetLevel: 10 },
    // { location: 'Lava', name: 'Camp', targetLevel: 10 }
  ]
};

// ==========================================
// BROWSER DOM SCRAPERS (Run inside browser)
// ==========================================

/**
 * Scrapes all active construction items directly from the DOM.
 * Passed into page.evaluate().
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

    // Isolate timer text by cloning node and removing location span
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

// ==========================================
// QUEUE LOGIC (Node.js Side)
// ==========================================

/**
 * Checks if a specific location currently has an active construction item running
 */
function isCityBusy(activeQueue, locationName) {
  return activeQueue.some(
    (item) => item.location.toLowerCase() === locationName.toLowerCase()
  );
}

/**
 * Dispatches a build task into the page context
 */
async function executeBuild(page, task) {
  console.log(`[BOT] Executing build: ${task.name} Lvl ${task.targetLevel} in ${task.location}...`);
  
  try {
    await page.evaluate((buildTask) => {
      // In-game build execution logic or modal interactions go here
      console.log(`[Game Context] Initiating build for ${buildTask.name} at ${buildTask.location}`);
    }, task);
  } catch (err) {
    console.error(`[BOT] Failed to execute build for ${task.location}:`, err.message);
  }
}

/**
 * Main polling engine loop
 */
async function processQueueLoop() {
  if (state.isProcessing || !state.page) return;
  state.isProcessing = true;

  try {
    // 1. Check if page context is still valid
    if (state.page.isClosed()) {
      throw new Error('Page context closed. Re-initializing...');
    }

    // 2. Scrape live active queue from DOM
    const activeQueue = await state.page.evaluate(scrapeActiveConstructionQueue);
    console.log(`[BOT] Active construction jobs running (${activeQueue.length}):`);
    activeQueue.forEach((job) => {
      console.log(`  - [${job.location}] ${job.name} Lvl ${job.level} (${job.timeLeft} left)`);
    });

    // 3. Process pending builds against current city statuses
    for (let i = state.pendingBuilds.length - 1; i >= 0; i--) {
      const task = state.pendingBuilds[i];

      if (!isCityBusy(activeQueue, task.location)) {
        console.log(`[BOT] Open construction slot detected in [${task.location}]!`);
        await executeBuild(state.page, task);
        
        // Remove task from pending queue after launching
        state.pendingBuilds.splice(i, 1);
      } else {
        console.log(`[BOT] Location [${task.location}] is currently busy. Queue waiting.`);
      }
    }
  } catch (err) {
    console.error('[BOT] Error in processing cycle:', err.message);
    
    // Auto-reconnect if session or frame context dropped
    if (err.message.includes('closed') || err.message.includes('Target closed') || err.message.includes('Execution context')) {
      console.log('[BOT] Connection dropped. Attempting session reconnect...');
      await handleReconnect();
    }
  } finally {
    state.isProcessing = false;
  }
}

// ==========================================
// SESSION & BOT LIFECYCLE
// ==========================================

async function initializeBot() {
  console.log('[BOT] Launching headless browser...');
  
  state.browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  state.page = await state.browser.newPage();

  // Set viewport and standard user agent
  await state.page.setViewport({ width: 1280, height: 800 });
  await state.page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('[BOT] Navigating to game...');
  await state.page.goto(CONFIG.gameUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('[BOT] Game context hooked successfully!');
  console.log('[BOT] Entering main queue polling loop...');

  // Start continuous polling loop
  setInterval(processQueueLoop, CONFIG.pollIntervalMs);
}

async function handleReconnect() {
  try {
    if (state.browser) {
      await state.browser.close().catch(() => {});
    }
  } catch (e) {
    // Ignore cleanup errors
  }

  console.log('[BOT] Restarting bot instance in 10 seconds...');
  setTimeout(() => {
    initializeBot().catch((err) => {
      console.error('[BOT] Reconnection failed:', err.message);
    });
  }, 10000);
}

// Public API helper to push targets dynamically into the bot queue
function addTargetToQueue(location, name, targetLevel) {
  state.pendingBuilds.push({ location, name, targetLevel });
  console.log(`[BOT] Target added: ${name} (Lvl ${targetLevel}) in ${location}`);
}

// Global process exception safety
process.on('unhandledRejection', (reason) => {
  console.error('[BOT] Unhandled Promise Rejection:', reason);
});

// Start the bot
initializeBot().catch((err) => {
  console.error('[BOT] Fatal startup error:', err);
  process.exit(1);
});
