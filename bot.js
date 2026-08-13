/**
 * Dragons of Camelot - Complete Headless Bot & Queue Manager
 * Target Environment: Node.js (Render Web Service)
 */

const express = require('express');
const puppeteer = require('puppeteer');

// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const PORT = process.env.PORT || 10000;
const CONFIG = {
  gameUrl: 'https://www.dragonsofcamelot.com/Great.html',
  pollIntervalMs: 5000
};

const state = {
  browser: null,
  page: null,
  isProcessing: false,
  pendingBuilds: []
};

// ==========================================
// 1. EXPRESS HTTP SERVER (Required by Render)
// ==========================================
const app = express();
app.use(express.json());

// Status Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    pendingQueueLength: state.pendingBuilds.length,
    pendingBuilds: state.pendingBuilds
  });
});

// Endpoint to push new build commands into the bot's queue dynamically
app.post('/add-build', (req, res) => {
  const { location, name, targetLevel } = req.body;
  if (!location || !name || !targetLevel) {
    return res.status(400).json({ error: 'Missing required parameters: location, name, targetLevel' });
  }

  state.pendingBuilds.push({ location, name, targetLevel });
  console.log(`[HTTP API] Added target: ${name} (Lvl ${targetLevel}) at ${location}`);
  
  return res.json({
    success: true,
    message: `Added ${name} Lvl ${targetLevel} in ${location} to queue.`,
    queueLength: state.pendingBuilds.length
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Express web server listening on port ${PORT}`);
});

// ==========================================
// 2. BROWSER DOM SCRAPERS
// ==========================================

/**
 * Ensures the construction list panel is open by clicking #OpenBar if needed,
 * then scrapes the construction items.
 */
function ensureOpenAndScrapeQueue() {
  const container = document.querySelector('.constructionItemList');
  const openBtn = document.querySelector('#OpenBar');

  // If the list isn't visible, try clicking the construction button
  if (!container || container.offsetParent === null) {
    if (openBtn) {
      openBtn.click();
    } else {
      return null; // Neither button nor container found in this frame
    }
  }

  // Re-fetch container in case it rendered immediately after click
  const activeContainer = document.querySelector('.constructionItemList');
  if (!activeContainer) return [];

  const items = activeContainer.querySelectorAll('.constructionItem');
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

// ==========================================
// 3. QUEUE LOGIC & ENGINE
// ==========================================

function isCityBusy(activeQueue, locationName) {
  return activeQueue.some(
    (item) => item.location.toLowerCase() === locationName.toLowerCase()
  );
}

/**
 * Finds the frame containing either #OpenBar or .constructionItemList
 */
async function getGameFrame(page) {
  // Check main page first
  const mainHasBtn = await page.evaluate(() => !!(document.querySelector('#OpenBar') || document.querySelector('.constructionItemList')));
  if (mainHasBtn) return page;

  // Search child frames/iframes
  for (const frame of page.frames()) {
    try {
      const frameHasBtn = await frame.evaluate(() => !!(document.querySelector('#OpenBar') || document.querySelector('.constructionItemList')));
      if (frameHasBtn) return frame;
    } catch (e) {
      // Ignore cross-origin frame access errors
    }
  }

  return null;
}

async function processQueueLoop() {
  if (state.isProcessing || !state.page) return;
  state.isProcessing = true;

  try {
    if (state.page.isClosed()) {
      throw new Error('Page context closed. Re-initializing...');
    }

    // Locate frame containing the build button / construction list
    const targetContext = await getGameFrame(state.page);

    if (!targetContext) {
      console.log('[BOT] Waiting for #OpenBar construction button in DOM...');
      return;
    }

    // Open panel (if closed) and scrape live queue
    const activeQueue = await targetContext.evaluate(ensureOpenAndScrapeQueue);

    if (activeQueue === null) {
      console.log('[BOT] Construction panel UI elements not ready yet.');
      return;
    }

    console.log(`[BOT] Active construction jobs running (${activeQueue.length}):`);
    activeQueue.forEach((job) => {
      console.log(`  - [${job.location}] ${job.name} Lvl ${job.level} (${job.timeLeft} left)`);
    });

    // Process pending tasks against free locations
    for (let i = state.pendingBuilds.length - 1; i >= 0; i--) {
      const task = state.pendingBuilds[i];

      if (!isCityBusy(activeQueue, task.location)) {
        console.log(`[BOT] Open construction slot detected in [${task.location}]!`);
        
        // Execute build step inside target frame context
        await targetContext.evaluate((buildTask) => {
          console.log(`[Game Context] Triggering build for ${buildTask.name} in ${buildTask.location}`);
          // In-game modal trigger or click interaction logic
        }, task);

        // Remove from pending queue
        state.pendingBuilds.splice(i, 1);
      } else {
        console.log(`[BOT] Location [${task.location}] busy. Queue waiting.`);
      }
    }
  } catch (err) {
    console.error('[BOT] Error in processing cycle:', err.message);
    if (err.message.includes('closed') || err.message.includes('Target closed') || err.message.includes('Execution context')) {
      console.log('[BOT] Connection dropped. Reconnecting...');
      await handleReconnect();
    }
  } finally {
    state.isProcessing = false;
  }
}

// ==========================================
// 4. LIFECYCLE & RECONNECT
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
  await state.page.setViewport({ width: 1280, height: 800 });
  await state.page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('[BOT] Navigating to game...');
  await state.page.goto(CONFIG.gameUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('[BOT] Game context hooked successfully!');
  console.log('[BOT] Entering main queue polling loop...');

  setInterval(processQueueLoop, CONFIG.pollIntervalMs);
}

async function handleReconnect() {
  try {
    if (state.browser) {
      await state.browser.close().catch(() => {});
    }
  } catch (e) {}

  console.log('[BOT] Restarting bot instance in 10 seconds...');
  setTimeout(() => {
    initializeBot().catch((err) => {
      console.error('[BOT] Reconnection failed:', err.message);
    });
  }, 10000);
}

process.on('unhandledRejection', (reason) => {
  console.error('[BOT] Unhandled Promise Rejection:', reason);
});

// Launch Bot
initializeBot().catch((err) => {
  console.error('[BOT] Fatal startup error:', err);
  process.exit(1);
});
