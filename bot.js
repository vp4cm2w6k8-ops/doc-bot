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

// Full list of Cities/Outposts from the .city-select DOM element
const CITIES = [
  'Main',
  'Water',
  'Soul',
  'Abyssal',
  'Chronos',
  'Stone',
  'Ice',
  'Tempest',
  'Skythrone',
  'Lava',
  'Sunken',
  'Steelshard',
  'Wind',
  'Gaia',
  'Luna',
  'Solarian',
  'Lost'
];

const BUILDINGS = [
  'Barracks',
  'House',
  'Keep',
  'Rally Point',
  'Dragon Keep',
  'Sentinel',
  'Science',
  'Metal',
  'Officer',
  'Factory',
  'Storehouse',
  'Theater',
  'Camp',
  'Garrison',
  'Wall',
  'Portal',
  'Mausoleum',
  'Spectral Keep',
  'Silo',
  'Stone Dragon Keep',
  'Lava Dragon Keep'
];

// Map image filenames to human-readable building names
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
  'waterhouse': 'House',
  'building': 'Under Construction'
};

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
  const buildingOptions = BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');

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

// Add Task
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

// Clear Queue
app.get('/clear', (req, res) => {
  state.pendingBuilds = [];
  console.log('[CONTROL PANEL] Cleared all pending queue targets.');
  res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Express web server listening on port ${PORT}`);
});

// ==========================================
// 2. BROWSER DOM SCRAPERS
// ==========================================

function scrapeCityStates() {
  const container = document.querySelector('.city-select');
  if (!container) return [];

  const buttons = container.querySelectorAll('button');
  const cities = [];

  buttons.forEach((btn) => {
    const id = btn.id;
    const isOwned = btn.classList.contains('city-owned');
    const isSelected = btn.classList.contains('empire-status-selected');
    const isBuildingBusy = btn.classList.contains('empire-building-busy');
    const isTrainingBusy = btn.classList.contains('empire-training-busy');

    cities.push({
      id,
      isOwned,
      isSelected,
      isBuildingBusy,
      isTrainingBusy
    });
  });

  return cities;
}

function scrapeCitySlots(imageMap) {
  const slots = document.querySelectorAll('button.buildingSlot');
  const cityState = [];

  slots.forEach((slot) => {
    const slotId = slot.id;
    const levelSpan = slot.querySelector('span');
    const isEmpty = slot.classList.contains('emptyBuildingSlot');
    const currentLevel = (levelSpan && !isEmpty) ? parseInt(levelSpan.textContent.trim(), 10) : 0;
    const styleBg = slot.style.backgroundImage || '';
    const isBuilding = slot.getAttribute('data-timer-lock') === '1' || styleBg.includes('Building.gif');

    let detectedName = isEmpty ? 'Empty Slot' : 'Unknown';
    if (!isEmpty) {
      for (const [key, val] of Object.entries(imageMap)) {
        if (styleBg.toLowerCase().includes(key)) {
          detectedName = val;
          break;
        }
      }
    }

    cityState.push({
      id: slotId,
      name: detectedName,
      level: currentLevel,
      isEmpty: isEmpty,
      isBuilding: isBuilding
    });
  });

  return cityState;
}

// ==========================================
// 3. QUEUE LOGIC & POLLING ENGINE
// ==========================================

async function getGameFrame(page) {
  const frames = page.frames();

  // Check main page context
  try {
    const mainHasBtn = await page.evaluate(() => 
      !!(document.querySelector('.buildingSlot') || document.querySelector('.city-select'))
    );
    if (mainHasBtn) return page;
  } catch (e) {}

  // Check child frames
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

  // Debug logging: show total frame count if not found yet
  console.log(`[BOT] Searching frame tree (${frames.length} frames detected)...`);
  return null;
}

async function processQueueLoop() {
  if (state.isProcessing || !state.page) return;
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

    if (cityOverview.length > 0) {
      const owned = cityOverview.filter(c => c.isOwned).map(c => c.id.replace('City', ''));
      const activeBuildingCities = cityOverview.filter(c => c.isBuildingBusy).map(c => c.id.replace('City', ''));
      
      console.log(`[BOT] Owned Cities (${owned.length}): ${owned.join(', ')}`);
      if (activeBuildingCities.length > 0) {
        console.log(`[BOT] Cities with active construction: ${activeBuildingCities.join(', ')}`);
      }
    }

    if (slotsData && slotsData.length > 0) {
      const activeUpgrades = slotsData.filter(s => s.isBuilding);
      console.log(`[BOT] Scanned current city view (${slotsData.length} slots). Upgrades active in this view: ${activeUpgrades.length}`);
    }

  } catch (err) {
    console.error('[BOT] Polling error:', err.message);
  } finally {
    state.isProcessing = false;
  }
}

// ==========================================
// 4. LIFECYCLE INITIALIZATION
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

  console.log('[BOT] Navigating to game...');
  
  // Network idle ensures resources like game frames finish loading
  await state.page.goto(CONFIG.gameUrl, { waitUntil: 'networkidle2', timeout: 90000 });

  console.log('[BOT] Game context hooked successfully!');
  console.log('[BOT] Entering main queue polling loop...');

  setInterval(processQueueLoop, CONFIG.pollIntervalMs);
}

// Launch Bot
initializeBot().catch((err) => {
  console.error('[BOT] Startup error:', err);
  process.exit(1);
});
