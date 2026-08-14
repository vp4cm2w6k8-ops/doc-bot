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
  activeBuilds: [], // Track active upgrades in game slots
  activeCity: 'Main'
};

// Full list of Cities/Outposts from the .city-select DOM element
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

// Map image filenames/keys to human-readable building names
const IMAGE_MAP = {
  'barracks': 'Barracks',
  'house': 'House',
  'adultdragon': 'Dragon Keep',
  'adultstonedragon': 'Stone Dragon Keep',
  'adultlavadragon': 'Lava Dragon Keep',
  'rally': 'Rally Point',
  'theater': 'Theater',
  'mstore': 'Storehouse',
  'wstore': 'Storehouse',
  'factory': 'Factory',
  'sentinel': 'Sentinel',
  'science': 'Science',
  'metal': 'Metal',
  'officer': 'Officer',
  'portal': 'Portal',
  'maus': 'Mausoleum',
  'spec': 'Spectral Keep',
  'silo': 'Silo',
  'camp': 'Camp',
  'waterhouse': 'House'
};

// ==========================================
// 1. EXPRESS HTTP SERVER & DASHBOARD
// ==========================================
const app = express();
app.use(express.json());

// HTML Snapshot Debugger Endpoint
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
          </style>
        </head>
        <body>
          <h2>Puppeteer Diagnostics Log</h2>
          <p><b>Current URL:</b> ${url}</p>
          <p><b>Title:</b> ${title}</p>
          <p><b>Stored Cookies Count:</b> ${cookies.length}</p>
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

app.get('/', (req, res) => {
  // Pending queue rows
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

  // Active in-progress rows
  const activeRows = state.activeBuilds.length === 0
    ? `<tr><td colspan="4" style="text-align:center; padding:15px; color:#888;">No active building construction detected</td></tr>`
    : state.activeBuilds.map((b) => `
        <tr style="border-bottom: 1px solid #333;">
          <td style="padding:10px;"><span class="badge badge-active">${state.activeCity}</span></td>
          <td style="padding:10px; font-weight:bold; color:#FFF;">${b.name}</td>
          <td style="padding:10px;">Upgrading to Lvl ${b.level > 0 ? b.level + 1 : 'Next'}</td>
          <td style="padding:10px; text-align:right;">
            <span style="color:#FFB74D; font-weight:bold; font-family:monospace; font-size:1.1em;">⏱️ ${b.timeLeft}</span>
          </td>
        </tr>
      `).join('');

  const cityOptions = CITIES.map(c => `<option value="${c}">${c}</option>`).join('');
  const buildingOptions = BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>DoC Build Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
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
          .badge-active { background: #E65100; color: #FFF; }
          .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
          .preset-btn { width: auto; background: #333; font-size: 0.8em; padding: 6px 12px; }
          .nav-links { margin-bottom: 15px; font-size: 0.85em; }
          .nav-links a { color: #64B5F6; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2>Dragons of Camelot - Control Dashboard</h2>
          </div>
          <div class="nav-links">
            <a href="/debug/dom" target="_blank">🔍 View Raw DOM & Session Diagnostic Inspector</a>
          </div>

          <!-- ACTIVE CONSTRUCTION CARD -->
          <div class="card" style="border-left: 4px solid #FF9800;">
            <h3 style="color:#FF9800;">🔨 Active Construction (${state.activeBuilds.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>City / Outpost</th>
                  <th>Building</th>
                  <th>Target</th>
                  <th style="text-align:right;">Time Remaining</th>
                </tr>
              </thead>
              <tbody>${activeRows}</tbody>
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
// 2. ENHANCED DOM SCRAPERS
// ==========================================

function scrapeCityStates() {
  const cities = [];

  // 1. Try standard empire selection container buttons
  const container = document.querySelector('.city-select, #city-select, .empire-city-list');
  if (container) {
    const buttons = container.querySelectorAll('button, a, div.city-item');
    buttons.forEach((btn) => {
      const isSelected = btn.classList.contains('empire-status-selected') || 
                         btn.classList.contains('selected') || 
                         btn.classList.contains('active');

      // Extract specific city name (prevent fallback to "Home")
      let name = btn.getAttribute('data-cityname') || 
                 btn.getAttribute('title') || 
                 btn.getAttribute('data-title');

      if (!name) {
        const rawText = btn.textContent.trim();
        // Ignore generic labels like "Home" or "City"
        if (rawText && !['home', 'city', 'cities'].includes(rawText.toLowerCase())) {
          name = rawText;
        } else if (btn.id) {
          name = btn.id.replace(/^city_?|^btn_?/i, '');
        }
      }

      if (name) {
        cities.push({
          id: btn.id || name,
          cityName: name,
          isOwned: true,
          isSelected: isSelected
        });
      }
    });
  }

  // 2. Fallback: inspect top header/city title display if dropdown container is unparsed
  if (cities.length === 0) {
    const activeHeader = document.querySelector('#currentCityName, .current-city-title, .city-name-display');
    if (activeHeader && activeHeader.textContent.trim()) {
      const headerText = activeHeader.textContent.trim();
      if (!['home', 'city'].includes(headerText.toLowerCase())) {
        cities.push({
          id: 'active_header_city',
          cityName: headerText,
          isOwned: true,
          isSelected: true
        });
      }
    }
  }

  return cities;
}

function scrapeCitySlots(imageMap) {
  const slots = document.querySelectorAll('button.buildingSlot, div.buildingSlot, .building-slot');
  const cityState = [];

  slots.forEach((slot) => {
    const levelSpan = slot.querySelector('span, .building-level, .lvl');
    const isEmpty = slot.classList.contains('emptyBuildingSlot') || slot.classList.contains('empty');
    const currentLevel = (levelSpan && !isEmpty) ? parseInt(levelSpan.textContent.replace(/\D/g, ''), 10) || 0 : 0;
    const styleBg = (slot.style.backgroundImage || '').toLowerCase();

    // Check construction flags
    const hasTimerLock = slot.getAttribute('data-timer-lock') === '1';
    const hasBuildingGif = styleBg.includes('building.gif') || styleBg.includes('constructing');
    const hasProgressClass = slot.classList.contains('buildingSlotBusy') || 
                             slot.classList.contains('in-progress') || 
                             slot.classList.contains('constructing');

    // Search specifically for game countdown timer elements
    const timerElem = slot.querySelector('.timer, .construction-timer, .slot-timer, .bld-timer, [id*="timer"], [class*="timer"], [id*="time"]');
    
    // Look for formatted time strings (e.g. 00:05:23 or 05:23)
    let extractedTime = null;

    if (timerElem && timerElem.textContent.trim()) {
      extractedTime = timerElem.textContent.trim();
    } else {
      // Scan all text nodes inside slot for match matching time format
      const allTexts = Array.from(slot.querySelectorAll('div, span, p')).map(e => e.textContent.trim());
      for (const txt of allTexts) {
        const match = txt.match(/\b(?:\d{1,2}:)?\d{2}:\d{2}\b/);
        if (match) {
          extractedTime = match[0];
          break;
        }
      }
    }

    const isBuilding = hasTimerLock || hasBuildingGif || hasProgressClass || !!extractedTime;
    const timeLeft = extractedTime || (isBuilding ? 'In Progress' : '');

    // Resolve human-readable building name
    let detectedName = isEmpty ? 'Empty Slot' : 'Building';

    for (const [key, val] of Object.entries(imageMap)) {
      if (styleBg.includes(key.toLowerCase())) {
        detectedName = val;
        break;
      }
    }

    if (detectedName === 'Building' || detectedName === 'Under Construction') {
      const tooltip = slot.getAttribute('title') || slot.getAttribute('data-title') || slot.getAttribute('aria-label');
      if (tooltip) {
        detectedName = tooltip.split('-')[0].split('Lvl')[0].trim();
      }
    }

    cityState.push({
      id: slot.id || 'unknown_slot',
      name: detectedName,
      level: currentLevel,
      isEmpty,
      isBuilding,
      timeLeft
    });
  });

  return cityState;
}

// ==========================================
// 3. DIAGNOSTIC AUTHENTICATION ENGINE
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
      await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    const modalTriggerSelector = 'button[popovertarget="login-modal-wrapper"], button.login-button';
    console.log('[DIAGNOSTIC] Waiting for login button selector...');
    await page.waitForSelector(modalTriggerSelector, { timeout: 15000 });
    
    console.log('[DIAGNOSTIC] Clicking login trigger...');
    await page.click(modalTriggerSelector);

    const emailSelector = '#login-email';
    const passwordSelector = '#login-password';
    const submitBtnSelector = '#pain1';

    await page.waitForSelector(emailSelector, { visible: true, timeout: 15000 });
    console.log('[DIAGNOSTIC] Login modal visible. Filling credentials...');

    await page.click(emailSelector, { clickCount: 3 });
    await page.type(emailSelector, email, { delay: 30 });

    await page.click(passwordSelector, { clickCount: 3 });
    await page.type(passwordSelector, password, { delay: 30 });

    console.log('[DIAGNOSTIC] Submitting credentials via #pain1...');
    await page.click(submitBtnSelector);

    await new Promise(resolve => setTimeout(resolve, 5000));

    const loginErrors = await page.evaluate(() => {
      const errNodes = document.querySelectorAll('.error, .alert, .login-error, #error-message, .modal-body');
      return Array.from(errNodes).map(e => e.textContent.trim()).filter(t => t.length > 0);
    });

    if (loginErrors.length > 0) {
      console.warn('[DIAGNOSTIC WARNING] Detected modal messages post-submit:', loginErrors.join(' | '));
    }

    const cookies = await page.cookies();
    console.log(`[DIAGNOSTIC] Cookies stored post-submit: ${cookies.length}`);

    console.log('[DIAGNOSTIC] Navigating to Great.html (using domcontentloaded)...');
    await page.goto(CONFIG.gameUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    const finalUrl = page.url();
    return !finalUrl.includes('index.html');
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

  const frames = page.frames();

  try {
    const mainHasBtn = await page.evaluate(() => 
      !!(document.querySelector('.buildingSlot') || document.querySelector('.city-select'))
    );
    if (mainHasBtn) return page;
  } catch (e) {}

  for (const frame of frames) {
    try {
      const frameHasBtn = await frame.evaluate(() => 
        !!(document.querySelector('.buildingSlot') || document.querySelector('.city-select'))
      );
      if (frameHasBtn) {
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

    const cityOverview = await targetContext.evaluate(scrapeCityStates);
    const slotsData = await targetContext.evaluate(scrapeCitySlots, IMAGE_MAP);

    // Track active city name accurately
    if (cityOverview.length > 0) {
      const currentSelected = cityOverview.find(c => c.isSelected);
      if (currentSelected && currentSelected.cityName) {
        state.activeCity = currentSelected.cityName;
      }
    }

    // Update active builds state
    if (slotsData && slotsData.length > 0) {
      state.activeBuilds = slotsData.filter(s => s.isBuilding);
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
  await state.page.goto(CONFIG.gameUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  await new Promise(resolve => setTimeout(resolve, 3000));

  const finalUrl = state.page.url();
  if (finalUrl.includes('index.html')) {
    console.log('[BOT] Session unauthenticated. Performing initial automated login...');
    await performLogin(state.page);
  }

  console.log('[BOT] Setup complete. Active construction polling enabled.');
  setInterval(processQueueLoop, CONFIG.pollIntervalMs);
}

initializeBot().catch((err) => {
  console.error('[BOT] Startup error:', err);
  process.exit(1);
});
