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
  loginUrl: 'https://www.dragonsofcamelot.com/index.html',
  pollIntervalMs: 5000
};

const state = {
  browser: null,
  page: null,
  isProcessing: false,
  isLoggingIn: false,
  pendingBuilds: [],
  // Categorized Active Queue State
  activeQueues: {
    construction: [],
    training: [],
    healing: [],
    research: []
  },
  activeCity: 'Main'
};

const CITIES = [
  'Main', 'Water', 'Soul', 'Abyssal', 'Chronos', 'Stone', 'Ice',
  'Tempest', 'Skythrone', 'Lava', 'Sunken', 'Steelshard', 'Wind',
  'Gaia', 'Luna', 'Solarian', 'Lost'
];

const BUILDINGS = [
  'Barracks', 'House', 'Keep', 'Rally Point', 'Dragon Keep',
  'Sentinel', 'Science', 'Metal', 'Officer', 'Factory',
  'Storehouse', 'Theater', 'Camp', 'Garrison', 'Wall',
  'Portal', 'Mausoleum', 'Spectral Keep', 'Silo',
  'Stone Dragon Keep', 'Lava Dragon Keep'
];

// ==========================================
// 1. EXPRESS HTTP SERVER & DASHBOARD
// ==========================================
const app = express();
app.use(express.json());

// Visual Screenshot Debugger
app.get('/debug/screenshot', async (req, res) => {
  if (!state.page) return res.status(500).send('No active Puppeteer page context.');
  try {
    const buffer = await state.page.screenshot({ fullPage: true });
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).send(`Error capturing screenshot: ${err.message}`);
  }
});

// Raw DOM & Session Diagnostic Inspector
app.get('/debug/dom', async (req, res) => {
  if (!state.page) {
    return res.status(500).send('Puppeteer page instance not initialized.');
  }

  try {
    const url = state.page.url();
    const title = await state.page.title();
    const content = await state.page.content();
    const cookies = await state.page.cookies();

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bot Debugger - DOM Snapshot</title>
          <style>
            body { font-family: monospace; background: #121212; color: #e0e0e0; padding: 20px; }
            pre { background: #1e1e1e; padding: 15px; border-radius: 5px; overflow-x: auto; }
            textarea { width: 100%; height: 500px; background: #1a1a1a; color: #00ff66; border: 1px solid #333; font-family: monospace; padding: 10px; }
            a { color: #64B5F6; }
          </style>
        </head>
        <body>
          <h2>Puppeteer Diagnostics Log</h2>
          <p><b>Current URL:</b> ${url}</p>
          <p><b>Title:</b> ${title}</p>
          <p><b>Stored Cookies Count:</b> ${cookies.length}</p>
          <p><a href="/debug/screenshot" target="_blank">📸 View Live Browser Screenshot</a></p>
          <h3>Active Cookies:</h3>
          <pre>${JSON.stringify(cookies, null, 2)}</pre>
          <h3>Raw DOM Output:</h3>
          <textarea readonly>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error capturing DOM state: ${err.message}`);
  }
});

// Helper renderer for categorized queue tables
function renderQueueTable(items, emptyLabel, badgeClass = 'badge-active') {
  if (!items || items.length === 0) {
    return `<tr><td colspan="4" style="text-align:center; padding:12px; color:#888;">${emptyLabel}</td></tr>`;
  }
  return items.map((b) => `
    <tr style="border-bottom: 1px solid #333;">
      <td style="padding:10px;"><span class="badge ${badgeClass}">${b.location}</span></td>
      <td style="padding:10px; font-weight:bold; color:#FFF;">${b.name}</td>
      <td style="padding:10px;">${b.level ? 'Lvl ' + b.level : (b.quantity ? 'Qty ' + b.quantity : '-')}</td>
      <td style="padding:10px; text-align:right;">
        <span style="color:#FFB74D; font-weight:bold; font-family:monospace; font-size:1.05em;">⏱️ ${b.timeLeft}</span>
      </td>
    </tr>
  `).join('');
}

// Control Dashboard
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
  const buildingOptions = BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>DoC Activity & Build Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
          .container { max-width: 900px; margin: 0 auto; }
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
          .badge-active { background: #E65100; color: #FFF; }
          .badge-training { background: #2E7D32; color: #FFF; }
          .badge-healing { background: #C2185B; color: #FFF; }
          .badge-research { background: #7B1FA2; color: #FFF; }
          .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
          .preset-btn { width: auto; background: #333; font-size: 0.8em; padding: 6px 12px; }
          .nav-links { margin-bottom: 15px; font-size: 0.85em; }
          .nav-links a { color: #64B5F6; text-decoration: none; margin-right: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2>Dragons of Camelot - Activity Control Dashboard</h2>
          </div>
          <div class="nav-links">
            <a href="/debug/dom" target="_blank">🔍 View Raw DOM Inspector</a>
            <a href="/debug/screenshot" target="_blank">📸 Live Browser Snapshot</a>
          </div>

          <!-- CATEGORIZED ACTIVE QUEUES -->
          <div class="card" style="border-left: 4px solid #FF9800;">
            <h3 style="color:#FF9800;">🔨 Building Upgrades (${state.activeQueues.construction.length})</h3>
            <table>
              <thead>
                <tr><th>City / Outpost</th><th>Building</th><th>Target Level</th><th style="text-align:right;">Time Remaining</th></tr>
              </thead>
              <tbody>${renderQueueTable(state.activeQueues.construction, 'No active building upgrades', 'badge-active')}</tbody>
            </table>
          </div>

          <div class="card" style="border-left: 4px solid #4CAF50;">
            <h3 style="color:#4CAF50;">⚔️ Troop Training Queues (${state.activeQueues.training.length})</h3>
            <table>
              <thead>
                <tr><th>City / Outpost</th><th>Troop Type</th><th>Amount</th><th style="text-align:right;">Time Remaining</th></tr>
              </thead>
              <tbody>${renderQueueTable(state.activeQueues.training, 'No active troop training queues', 'badge-training')}</tbody>
            </table>
          </div>

          <div class="card" style="border-left: 4px solid #E91E63;">
            <h3 style="color:#E91E63;">🐉 Dragon Sanctuary & Healing (${state.activeQueues.healing.length})</h3>
            <table>
              <thead>
                <tr><th>City / Outpost</th><th>Dragon / Unit</th><th>Details</th><th style="text-align:right;">Time Remaining</th></tr>
              </thead>
              <tbody>${renderQueueTable(state.activeQueues.healing, 'No active dragon healing tasks', 'badge-healing')}</tbody>
            </table>
          </div>

          <div class="card" style="border-left: 4px solid #9C27B0;">
            <h3 style="color:#9C27B0;">🧪 Alchemy & Research (${state.activeQueues.research.length})</h3>
            <table>
              <thead>
                <tr><th>City / Outpost</th><th>Technology</th><th>Level</th><th style="text-align:right;">Time Remaining</th></tr>
              </thead>
              <tbody>${renderQueueTable(state.activeQueues.research, 'No active research in progress', 'badge-research')}</tbody>
            </table>
          </div>
          
          <div class="card">
            <h3>Schedule Build Target</h3>
            <form action="/add" method="GET">
              <div class="grid">
                <div>
                  <label style="font-size:0.8em; color:#888;">City Location</label>
                  <select name="location">${cityOptions}</select>
                </div>
                <div>
                  <label style="font-size:0.8em; color:#888;">Building Type</label>
                  <select name="name">${buildingOptions}</select>
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
                <a href="/add?location=Stone&name=Silo&targetLevel=10"><button class="preset-btn">+ Stone Silo Lvl 10</button></a>
                <a href="/add?location=Lava&name=Camp&targetLevel=10"><button class="preset-btn">+ Lava Camp Lvl 10</button></a>
                <a href="/add?location=Soul&name=Mausoleum&targetLevel=10"><button class="preset-btn">+ Soul Mausoleum Lvl 10</button></a>
              </div>
            </div>
          </div>

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

app.get('/remove', (req, res) => {
  const index = parseInt(req.query.index, 10);
  if (!isNaN(index) && index >= 0 && index < state.pendingBuilds.length) {
    const removed = state.pendingBuilds.splice(index, 1);
    console.log(`[CONTROL PANEL] Removed item #${index + 1}:`, removed[0]);
  }
  res.redirect('/');
});

app.get('/clear', (req, res) => {
  state.pendingBuilds = [];
  console.log('[CONTROL PANEL] Cleared all pending queue targets.');
  res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Express web server listening on port ${PORT}`);
});

// ==========================================
// 2. CATEGORIZED OVERLAY DRAWER SCRAPER
// ==========================================

async function ensureConstructionDrawerOpen(page) {
  try {
    const frames = [page, ...page.frames()];

    for (const frame of frames) {
      try {
        const opened = await frame.evaluate(() => {
          const drawerItems = document.querySelectorAll('.constructionItem, .queueItem, .activityItem');
          if (drawerItems.length > 0) return true; // Already open

          const openBtn = document.querySelector('#OpenBar, .build-btn');
          if (openBtn) {
            openBtn.click();
            return true;
          }
          return false;
        });

        if (opened) break;
      } catch (e) {
        // Cross-origin frame handling
      }
    }
  } catch (err) {
    console.warn('[BOT WARNING] Error toggling activity drawer:', err.message);
  }
}

function scrapeCategorizedDrawer() {
  const items = document.querySelectorAll('.constructionItem, .queueItem, .activityItem');
  
  const categorized = {
    construction: [],
    training: [],
    healing: [],
    research: []
  };

  items.forEach((item) => {
    // 1. Name & Type Details
    const nameNode = item.querySelector('.itemName, #itemName, .title');
    const name = nameNode ? nameNode.textContent.trim() : 'Unknown Activity';

    // 2. Target Level / Quantity
    const qtyNode = item.querySelector('.itemQuantity, #itemQuantity, .amount');
    const levelOrQty = qtyNode ? parseInt(qtyNode.textContent.trim(), 10) || 0 : 0;

    // 3. Location Outpost Name
    const locationNode = item.querySelector('.buildTimerLocation, .location');
    const location = locationNode ? locationNode.textContent.trim() : 'Main';

    // 4. Time Left
    const timerNode = item.querySelector('#timer, .timer, .timeLeft');
    let timeLeft = 'In Progress';

    if (timerNode) {
      const clonedTimer = timerNode.cloneNode(true);
      const locSubNode = clonedTimer.querySelector('.buildTimerLocation, .location');
      if (locSubNode) {
        locSubNode.remove();
      }
      const rawText = clonedTimer.textContent.replace('Time Left:', '').trim();
      if (rawText) {
        timeLeft = rawText;
      }
    }

    // 5. Inspect attributes for Category Classification
    const speedUpNode = item.querySelector('[data-type], [data-speedup-type], .speedUpIcon');
    const dataType = speedUpNode ? (speedUpNode.getAttribute('data-type') || speedUpNode.getAttribute('data-speedup-type') || '').toLowerCase() : '';
    const nameLower = name.toLowerCase();

    const queueObj = {
      name,
      level: levelOrQty,
      quantity: levelOrQty,
      location,
      timeLeft
    };

    // Classification Rules
    if (dataType.includes('train') || dataType.includes('troop') || nameLower.includes('militia') || nameLower.includes('archer') || nameLower.includes('knight') || nameLower.includes('wagon') || nameLower.includes('halberdier') || nameLower.includes('spy')) {
      categorized.training.push(queueObj);
    } else if (dataType.includes('heal') || dataType.includes('dragon') || nameLower.includes('dragon') || nameLower.includes('sanctuary') || nameLower.includes('heal')) {
      categorized.healing.push(queueObj);
    } else if (dataType.includes('research') || dataType.includes('alchemy') || dataType.includes('science') || nameLower.includes('alloy') || nameLower.includes('medicine') || nameLower.includes('levitation')) {
      categorized.research.push(queueObj);
    } else {
      // Default to construction/building upgrade
      categorized.construction.push(queueObj);
    }
  });

  return categorized;
}

// ==========================================
// 3. AUTHENTICATION ENGINE
// ==========================================

async function performLogin(page) {
  if (state.isLoggingIn) return false;
  state.isLoggingIn = true;

  const email = process.env.DOC_EMAIL;
  const password = process.env.DOC_PASSWORD;

  if (!email || !password) {
    console.error('[DIAGNOSTIC ERROR] Missing DOC_EMAIL or DOC_PASSWORD env variables!');
    state.isLoggingIn = false;
    return false;
  }

  console.log(`[DIAGNOSTIC] Initiating login flow for: ${email}`);

  try {
    if (!page.url().includes('index.html')) {
      await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    const emailVisible = await page.$('#login-email').then(el => el ? el.isVisible() : false);
    if (!emailVisible) {
      console.log('[DIAGNOSTIC] Opening login modal via trigger click...');
      await page.evaluate(() => {
        const btn = document.querySelector('button[popovertarget="login-modal-wrapper"], button.login-button, #loginButton');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 1500));
    }

    const emailSelector = '#login-email';
    const passwordSelector = '#login-password';
    const submitBtnSelector = '#pain1';

    await page.waitForSelector(emailSelector, { visible: true, timeout: 15000 });
    console.log('[DIAGNOSTIC] Login modal visible. Filling credentials...');

    await page.click(emailSelector, { clickCount: 3 });
    await page.type(emailSelector, email, { delay: 40 });

    await page.click(passwordSelector, { clickCount: 3 });
    await page.type(passwordSelector, password, { delay: 40 });

    console.log('[DIAGNOSTIC] Submitting credentials via #pain1...');
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.click(submitBtnSelector)
    ]);

    await new Promise(r => setTimeout(r, 3000));

    if (!page.url().includes('Great.html')) {
      console.log('[DIAGNOSTIC] Navigating directly to Great.html...');
      await page.goto(CONFIG.gameUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    }

    const finalUrl = page.url();
    console.log(`[DIAGNOSTIC] Current URL post-login attempt: ${finalUrl}`);

    return finalUrl.includes('Great.html');
  } catch (err) {
    console.error('[DIAGNOSTIC ERROR] Login flow failed:', err.stack || err.message);
    return false;
  } finally {
    state.isLoggingIn = false;
  }
}

// ==========================================
// 4. QUEUE LOGIC & POLLING ENGINE
// ==========================================

async function getGameFrame(page) {
  const currentUrl = page.url();

  if (currentUrl.includes('index.html')) {
    console.warn(`[BOT RECOVERY] Unauthenticated session detected at ${currentUrl}. Triggering auto-login...`);
    await performLogin(page);
    return null;
  }

  const frames = [page, ...page.frames()];

  for (const frame of frames) {
    try {
      const frameHasTarget = await frame.evaluate(() => 
        !!(document.querySelector('#OpenBar') || document.querySelector('.constructionItem') || document.querySelector('.buildingSlot'))
      );
      if (frameHasTarget) {
        return frame;
      }
    } catch (e) {}
  }

  return null;
}

async function processQueueLoop() {
  if (state.isProcessing || state.isLoggingIn || !state.page) return;
  state.isProcessing = true;

  try {
    if (state.page.isClosed()) {
      throw new Error('Page context closed.');
    }

    const targetContext = await getGameFrame(state.page);

    if (!targetContext) {
      return;
    }

    // Ensure side activity drawer is toggled open
    await ensureConstructionDrawerOpen(state.page);

    // Read and categorize active items from drawer
    const drawerQueues = await targetContext.evaluate(scrapeCategorizedDrawer);

    if (drawerQueues) {
      state.activeQueues = drawerQueues;
    }

  } catch (err) {
    console.error('[BOT] Polling error:', err.message);
  } finally {
    state.isProcessing = false;
  }
}

// ==========================================
// 5. INITIALIZATION
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
      '--disable-gpu',
      '--disable-web-security'
    ]
  });

  state.page = await state.browser.newPage();
  await state.page.setViewport({ width: 1280, height: 800 });
  await state.page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('[BOT] Loading game entry page...');
  await state.page.goto(CONFIG.gameUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  await new Promise(resolve => setTimeout(resolve, 3000));

  const finalUrl = state.page.url();
  if (finalUrl.includes('index.html')) {
    console.log('[BOT] Session unauthenticated. Performing initial automated login...');
    await performLogin(state.page);
  }

  console.log('[BOT] Setup complete. Active queue polling enabled.');
  setInterval(processQueueLoop, CONFIG.pollIntervalMs);
}

initializeBot().catch((err) => {
  console.error('[BOT] Startup error:', err);
  process.exit(1);
});
