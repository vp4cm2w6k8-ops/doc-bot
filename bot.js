/**
 * Dragons of Camelot - Headless Bot & Control Panel
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

// Supported game cities
const CITIES = ['Main', 'Water', 'Lava', 'Stone', 'Chronos', 'Ice', 'Sunken', 'Wind', 'Gaia'];

// ==========================================
// 1. EXPRESS HTTP SERVER & DASHBOARD
// ==========================================
const app = express();
app.use(express.json());

// Web Control Panel Interface
app.get('/', (req, res) => {
  const pendingRows = state.pendingBuilds.length === 0
    ? `<tr><td colspan="5" style="text-align:center; padding:15px; color:#888;">No pending builds scheduled</td></tr>`
    : state.pendingBuilds.map((b, i) => `
        <tr style="border-bottom: 1px solid #333;">
          <td style="padding:10px;">#${i + 1}</td>
          <td style="padding:10px;"><span class="badge">${b.location}</span></td>
          <td style="padding:10px;">${b.name}</td>
          <td style="padding:10px;">Level ${b.targetLevel}</td>
          <td style="padding:10px; text-align:right;">
            <a href="/remove?index=${i}" style="color:#ff5252; text-decoration:none; font-weight:bold;">Remove</a>
          </td>
        </tr>
      `).join('');

  const cityOptions = CITIES.map(c => `<option value="${c}">${c}</option>`).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>DoC Build Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
          .container { max-width: 800px; margin: 0 auto; }
          .card { background: #1e1e1e; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
          h2, h3 { margin-top: 0; color: #4CAF50; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 15px; }
          select, input, button { width: 100%; padding: 10px; border-radius: 4px; border: 1px solid #333; background: #2a2a2a; color: #fff; box-sizing: border-box; }
          button { background: #4CAF50; color: white; font-weight: bold; border: none; cursor: pointer; transition: background 0.2s; }
          button:hover { background: #45a049; }
          .btn-danger { background: #d32f2f; }
          .btn-danger:hover { background: #b71c1c; }
          table { width: 100%; border-collapse: collapse; text-align: left; }
          th { padding: 10px; background: #2a2a2a; color: #888; }
          .badge { background: #333; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; color: #64B5F6; }
          .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
          .preset-btn { width: auto; background: #333; font-size: 0.8em; padding: 6px 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Dragons of Camelot - Queue Dashboard</h2>
          
          <!-- Add Task Form -->
          <div class="card">
            <h3>Schedule Build Target</h3>
            <form action="/add" method="GET">
              <div class="grid">
                <div>
                  <label style="font-size:0.8em; color:#888;">City Location</label>
                  <select name="location">${cityOptions}</select>
                </div>
                <div>
                  <label style="font-size:0.8em; color:#888;">Building Name</label>
                  <input type="text" name="name" placeholder="e.g. Camp or Keep" required>
                </div>
                <div>
                  <label style="font-size:0.8em; color:#888;">Target Level</label>
                  <input type="number" name="targetLevel" value="10" min="1" max="20" required>
                </div>
              </div>
              <button type="submit">Queue Build Command</button>
            </form>

            <div style="margin-top:15px;">
              <span style="font-size:0.8em; color:#888;">Quick Presets:</span>
              <div class="presets">
                <a href="/add?location=Water&name=Camp&targetLevel=10"><button class="preset-btn">+ Water Camp Lvl 10</button></a>
                <a href="/add?location=Lava&name=Camp&targetLevel=10"><button class="preset-btn">+ Lava Camp Lvl 10</button></a>
                <a href="/add?location=Main&name=Keep&targetLevel=11"><button class="preset-btn">+ Main Keep Lvl 11</button></a>
              </div>
            </div>
          </div>

          <!-- Queue State -->
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
              <h3 style="margin:0;">Pending Build Schedule (${state.pendingBuilds.length})</h3>
              ${state.pendingBuilds.length > 0 ? `<a href="/clear" style="text-decoration:none;"><button class="btn-danger" style="width:auto; padding:6px 12px;">Clear All</button></a>` : ''}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Location</th>
                  <th>Building</th>
                  <th>Target</th>
                  <th style="text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody>${pendingRows}</tbody>
            </table>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Add Task via URL parameter or form submit
app.get('/add', (req, res) => {
  const location = req.query.location;
  const name = req.query.name || 'Building';
  const targetLevel = parseInt(req.query.targetLevel, 10) || 1;

  if (location) {
    state.pendingBuilds.push({ location, name, targetLevel });
    console.log(`[CONTROL PANEL] Added build: ${name} Lvl ${targetLevel} in [${location}]`);
  }
  
  res.redirect('/');
});

// Remove Single Task
app.get('/remove', (req, res) => {
  const index = parseInt(req.query.index, 10);
  if (!isNaN(index) && index >= 0 && index < state.pendingBuilds.length) {
    const removed = state.pendingBuilds.splice(index, 1);
    console.log(`[CONTROL PANEL] Removed item #${index + 1}:`, removed[0]);
  }
  res.redirect('/');
});

// Clear Entire Queue
app.get('/clear', (req, res) => {
  state.pendingBuilds = [];
  console.log('[CONTROL PANEL] Cleared all pending queue targets.');
  res.redirect('/');
});

// POST Endpoint: JSON integration
app.post('/add-build', (req, res) => {
  const { location, name, targetLevel } = req.body;
  if (!location || !name || !targetLevel) {
    return res.status(400).json({ error: 'Missing parameters: location, name, targetLevel' });
  }

  state.pendingBuilds.push({ location, name, targetLevel });
  console.log(`[HTTP API] Added target: ${name} Lvl ${targetLevel} at [${location}]`);
  
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

function ensureOpenAndScrapeQueue() {
  const container = document.querySelector('.constructionItemList');
  const openBtn = document.querySelector('#OpenBar');

  if (!container || container.offsetParent === null) {
    if (openBtn) {
      openBtn.click();
    } else {
      return null;
    }
  }

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
// 3. QUEUE LOGIC & POLLING ENGINE
// ==========================================

function isCityBusy(activeQueue, locationName) {
  return activeQueue.some(
    (item) => item.location.toLowerCase() === locationName.toLowerCase()
  );
}

async function getGameFrame(page) {
  const mainHasBtn = await page.evaluate(() => !!(document.querySelector('#OpenBar') || document.querySelector('.constructionItemList')));
  if (mainHasBtn) return page;

  for (const frame of page.frames()) {
    try {
      const frameHasBtn = await frame.evaluate(() => !!(document.querySelector('#OpenBar') || document.querySelector('.constructionItemList')));
      if (frameHasBtn) return frame;
    } catch (e) {}
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

    const targetContext = await getGameFrame(state.page);

    if (!targetContext) {
      console.log('[BOT] Waiting for #OpenBar construction button in DOM...');
      return;
    }

    const activeQueue = await targetContext.evaluate(ensureOpenAndScrapeQueue);

    if (activeQueue === null) {
      console.log('[BOT] Construction panel UI elements not ready yet.');
      return;
    }

    console.log(`[BOT] Active construction jobs running (${activeQueue.length}):`);
    activeQueue.forEach((job) => {
      console.log(`  - [${job.location}] ${job.name} Lvl ${job.level} (${job.timeLeft} left)`);
    });

    for (let i = state.pendingBuilds.length - 1; i >= 0; i--) {
      const task = state.pendingBuilds[i];

      if (!isCityBusy(activeQueue, task.location)) {
        console.log(`[BOT] Open construction slot detected in [${task.location}]!`);
        
        await targetContext.evaluate((buildTask) => {
          console.log(`[Game Context] Triggering build for ${buildTask.name} in ${buildTask.location}`);
          // In-game click or modal execution logic goes here
        }, task);

        state.pendingBuilds.splice(i, 1);
      } else {
        console.log(`[BOT] Location [${task.location}] busy. Waiting for slot...`);
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
