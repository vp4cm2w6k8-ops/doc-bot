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
  pendingTasks: [], // Unified Pending Queue (Builds, Training, Research)
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
  'Sentinel', 'Science Center', 'Metal Mine', 'Officer Quarter', 'Factory',
  'Storehouse', 'Theater', 'Camp', 'Garrison', 'Wall',
  'Portal', 'Mausoleum', 'Spectral Keep', 'Silo',
  'Stone Dragon Keep', 'Lava Dragon Keep'
];

const TROOPS = [
  'Militia', 'Swordsman', 'Scout', 'Pikeman', 'Archer',
  'Cavalry', 'Heavy Cavalry', 'Supply Wagon', 'Ballista',
  'Battering Ram', 'Catapult', 'Knight'
];

const RESEARCH_TECH = [
  'Agriculture', 'Woodcraft', 'Mining', 'Alloy', 'Levitation',
  'Medicine', 'Military Science', 'Poison', 'Fletching',
  'Horsebreeding', 'Engineering', 'Compass', 'Metal Working'
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
    res.status(500).send('Error capturing screenshot: ' + err.message);
  }
});

// Raw DOM Inspector
app.get('/debug/dom', async (req, res) => {
  if (!state.page) return res.status(500).send('Puppeteer page instance not initialized.');

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
    res.status(500).send('Error capturing DOM state: ' + err.message);
  }
});

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

// Main Dashboard Interface
app.get('/', (req, res) => {
  const pendingRows = state.pendingTasks.length === 0
    ? `<tr><td colspan="6" style="text-align:center; padding:15px; color:#888;">No pending tasks scheduled</td></tr>`
    : state.pendingTasks.map((t, i) => {
        let categoryBadge = 'badge-active';
        if (t.type === 'train') categoryBadge = 'badge-training';
        if (t.type === 'research') categoryBadge = 'badge-research';

        return `
          <tr style="border-bottom: 1px solid #333;">
            <td style="padding:10px;">#${i + 1}</td>
            <td style="padding:10px;"><span class="badge ${categoryBadge}">${t.type.toUpperCase()}</span></td>
            <td style="padding:10px;"><span class="badge">${t.location}</span></td>
            <td style="padding:10px; font-weight:bold; color:#FFF;">${t.name}</td>
            <td style="padding:10px;">${t.type === 'train' ? 'Qty ' + t.amount : 'Target Lvl ' + t.targetLevel}</td>
            <td style="padding:10px; text-align:right;">
              <a href="/remove?index=${i}" style="color:#ff5252; text-decoration:none; font-weight:bold;">Remove</a>
            </td>
          </tr>
        `;
      }).join('');

  const cityOptions = CITIES.map(c => `<option value="${c}">${c}</option>`).join('');
  const buildingOptions = BUILDINGS.map(b => `<option value="${b}">${b}</option>`).join('');
  const troopOptions = TROOPS.map(t => `<option value="${t}">${t}</option>`).join('');
  const researchOptions = RESEARCH_TECH.map(r => `<option value="${r}">${r}</option>`).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>DoC Command & Schedule Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
          .container { max-width: 950px; margin: 0 auto; }
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
          .nav-links { margin-bottom: 15px; font-size: 0.85em; }
          .nav-links a { color: #64B5F6; text-decoration: none; margin-right: 15px; }
          .scheduler-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2>Dragons of Camelot - Control Panel</h2>
          </div>
          <div class="nav-links">
            <a href="/debug/dom" target="_blank">🔍 View Raw DOM Inspector</a>
            <a href="/debug/screenshot" target="_blank">📸 Live Browser Snapshot</a>
          </div>

          <!-- ACTIVE QUEUES SECTION -->
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
            <h3 style="color:#E91E63;">🐉 Sanctuary & Dragon Healing (${state.activeQueues.healing.length})</h3>
            <table>
              <thead>
                <tr><th>City / Outpost</th><th>Dragon / Unit</th><th>Details</th><th style="text-align:right;">Time Remaining</th></tr>
              </thead>
              <tbody>${renderQueueTable(state.activeQueues.healing, 'No active dragon healing tasks', 'badge-healing')}</tbody>
            </table>
          </div>

          <div class="card" style="border-left: 4px solid #9C27B0;">
            <h3 style="color:#9C27B0;">🧪 Science Center Research (${state.activeQueues.research.length})</h3>
            <table>
              <thead>
                <tr><th>City / Outpost</th><th>Technology</th><th>Level</th><th style="text-align:right;">Time Remaining</th></tr>
              </thead>
              <tbody>${renderQueueTable(state.activeQueues.research, 'No active research in progress', 'badge-research')}</tbody>
            </table>
          </div>

          <!-- TASK SCHEDULERS GRID -->
          <h3 style="color:#FFF; margin-top:25px;">Schedule New Task</h3>
          <div class="scheduler-tabs">
            
            <!-- 1. BUILD SCHEDULER -->
            <div class="card" style="border-top: 3px solid #FF9800;">
              <h3 style="color:#FF9800;">🔨 Upgrade Building</h3>
              <form action="/add" method="GET">
                <input type="hidden" name="type" value="build">
                <div style="margin-bottom:10px;">
                  <label style="font-size:0.8em; color:#888;">City Location</label>
                  <select name="location">${cityOptions}</select>
                </div>
                <div style="margin-bottom:10px;">
                  <label style="font-size:0.8em; color:#888;">Building Type</label>
                  <select name="name">${buildingOptions}</select>
                </div>
                <div style="margin-bottom:15px;">
                  <label style="font-size:0.8em; color:#888;">Target Level</label>
                  <input type="number" name="targetLevel" value="10" min="1" max="20" required>
                </div>
                <button type="submit" style="background:#FF9800;">+ Queue Building Upgrade</button>
              </form>
            </div>

            <!-- 2. TROOP SCHEDULER -->
            <div class="card" style="border-top: 3px solid #4CAF50;">
              <h3 style="color:#4CAF50;">⚔️ Train Troops</h3>
              <form action="/add" method="GET">
                <input type="hidden" name="type" value="train">
                <div style="margin-bottom:10px;">
                  <label style="font-size:0.8em; color:#888;">City Location</label>
                  <select name="location">${cityOptions}</select>
                </div>
                <div style="margin-bottom:10px;">
                  <label style="font-size:0.8em; color:#888;">Troop Type</label>
                  <select name="name">${troopOptions}</select>
                </div>
                <div style="margin-bottom:15px;">
                  <label style="font-size:0.8em; color:#888;">Quantity</label>
                  <input type="number" name="amount" value="5000" min="1" max="100000" required>
                </div>
                <button type="submit" style="background:#4CAF50;">+ Queue Troop Training</button>
              </form>
            </div>

            <!-- 3. RESEARCH SCHEDULER -->
            <div class="card" style="border-top: 3px solid #9C27B0;">
              <h3 style="color:#9C27B0;">🧪 Science Center Research</h3>
              <form action="/add" method="GET">
                <input type="hidden" name="type" value="research">
                <div style="margin-bottom:10px;">
                  <label style="font-size:0.8em; color:#888;">City Location</label>
                  <select name="location">${cityOptions}</select>
                </div>
                <div style="margin-bottom:10px;">
                  <label style="font-size:0.8em; color:#888;">Technology</label>
                  <select name="name">${researchOptions}</select>
                </div>
                <div style="margin-bottom:15px;">
                  <label style="font-size:0.8em; color:#888;">Target Level</label>
                  <input type="number" name="targetLevel" value="10" min="1" max="20" required>
                </div>
                <button type="submit" style="background:#9C27B0;">+ Queue Research</button>
              </form>
            </div>

          </div>

          <!-- PENDING QUEUE TABLE -->
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
              <h3 style="margin:0;">Pending Task Schedule (${state.pendingTasks.length})</h3>
              ${state.pendingTasks.length > 0 ? `<a href="/clear" style="text-decoration:none;"><button class="btn-danger" style="width:auto; padding:6px 12px;">Clear All</button></a>` : ''}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Task / Name</th>
                  <th>Target / Amount</th>
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
  const type = req.query.type || 'build';
  const location = req.query.location;
  const name = req.query.name;
  const targetLevel = parseInt(req.query.targetLevel, 10) || 1;
  const amount = parseInt(req.query.amount, 10) || 1000;

  if (location && name) {
    const task = {
      type,
      location,
      name,
      targetLevel,
      amount
    };
    state.pendingTasks.push(task);
    console.log(`[CONTROL PANEL] Queued [${type.toUpperCase()}]: ${name} in [${location}]`);
  }
  res.redirect('/');
});

app.get('/remove', (req, res) => {
  const index = parseInt(req.query.index, 10);
  if (!isNaN(index) && index >= 0 && index < state.pendingTasks.length) {
    const removed = state.pendingTasks.splice(index, 1);
    console.log(`[CONTROL PANEL] Removed task #${index + 1}:`, removed[0]);
  }
  res.redirect('/');
});

app.get('/clear', (req, res) => {
  state.pendingTasks = [];
  console.log('[CONTROL PANEL] Cleared all pending tasks.');
  res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Express web server listening on port ${PORT}`);
});

// ==========================================
// 2. OVERLAY DRAWER SCRAPER & UTILS
// ==========================================

async function ensureConstructionDrawerOpen(page) {
  try {
    const frames = [page, ...page.frames()];

    for (const frame of frames) {
      try {
        const opened = await frame.evaluate(() => {
          const drawerItems = document.querySelectorAll('.constructionItem, .queueItem, .activityItem, tr.queueRow, div[id*="queue"]');
          if (drawerItems.length > 0) return true;

          const openBtn = document.querySelector('#OpenBar, .build-btn, #queueBarBtn');
          if (openBtn) {
            openBtn.click();
            return true;
          }
          return false;
        });

        if (opened) break;
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[BOT WARNING] Error toggling activity drawer:', err.message);
  }
}

function scrapeCategorizedDrawer() {
  const items = document.querySelectorAll('.constructionItem, .queueItem, .activityItem, tr.queueRow, div.queue_item');
  
  const categorized = {
    construction: [],
    training: [],
    healing: [],
    research: []
  };

  items.forEach((item) => {
    const nameNode = item.querySelector('.itemName, #itemName, .title, .name');
    const name = nameNode ? nameNode.textContent.trim() : 'Unknown Activity';

    const qtyNode = item.querySelector('.itemQuantity, #itemQuantity, .amount, .level');
    const levelOrQty = qtyNode ? parseInt(qtyNode.textContent.trim(), 10) || 0 : 0;

    const locationNode = item.querySelector('.buildTimerLocation, .location');
    const location = locationNode ? locationNode.textContent.trim() : 'Main';

    const timerNode = item.querySelector('#timer, .timer, .timeLeft, .time');
    let timeLeft = 'In Progress';

    if (timerNode) {
      const clonedTimer = timerNode.cloneNode(true);
      const locSubNode = clonedTimer.querySelector('.buildTimerLocation, .location');
      if (locSubNode) locSubNode.remove();
      const rawText = clonedTimer.textContent.replace('Time Left:', '').trim();
      if (rawText) timeLeft = rawText;
    }

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

    if (dataType.includes('train') || dataType.includes('troop') || nameLower.includes('militia') || nameLower.includes('archer') || nameLower.includes('knight') || nameLower.includes('wagon') || nameLower.includes('halberdier') || nameLower.includes('spy')) {
      categorized.training.push(queueObj);
    } else if (dataType.includes('heal') || dataType.includes('dragon') || nameLower.includes('dragon') || nameLower.includes('sanctuary') || nameLower.includes('heal')) {
      categorized.healing.push(queueObj);
    } else if (dataType.includes('research') || dataType.includes('science') || nameLower.includes('alloy') || nameLower.includes('medicine') || nameLower.includes('levitation') || nameLower.includes('mining') || nameLower.includes('woodcraft') || nameLower.includes('agriculture') || nameLower.includes('fletching') || nameLower.includes('compass')) {
      categorized.research.push(queueObj);
    } else {
      categorized.construction.push(queueObj);
    }
  });

  return categorized;
}

// ==========================================
// 3. EXECUTION ENGINE (BUILDINGS & SCIENCE CENTER)
// ==========================================

async function executeBuildingUpgrade(frame, task) {
  try {
    console.log(`[BUILD ENGINE] Attempting upgrade: ${task.name} in [${task.location}] to Lvl ${task.targetLevel}`);

    let isMenuOpen = await frame.evaluate(() => {
      const menu = document.querySelector('#UpgradeMenu, #modal_building, .modalBuilding');
      return menu && window.getComputedStyle(menu).display !== 'none';
    });

    if (!isMenuOpen) {
      const clicked = await frame.evaluate((buildingName) => {
        const slots = Array.from(document.querySelectorAll('.buildingSlot, .building, [data-building-type], div[id*="building"], .slot'));
        const target = slots.find(el => el.textContent.toLowerCase().includes(buildingName.toLowerCase()));
        
        if (target) {
          target.click();
          return true;
        }
        return false;
      }, task.name);

      if (!clicked) {
        console.warn(`[BUILD ENGINE] Could not find building slot for '${task.name}' in DOM.`);
        return false;
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    const upgradeResult = await frame.evaluate(() => {
      const menu = document.querySelector('#UpgradeMenu, #modal_building, .modalBuilding');
      if (!menu || window.getComputedStyle(menu).display === 'none') {
        return { success: false, reason: 'Upgrade menu not visible.' };
      }

      const upgradeBtn = document.querySelector('#upgrade, .btnUpgrade, button.upgrade');
      if (!upgradeBtn || window.getComputedStyle(upgradeBtn).display === 'none') {
        return { success: false, reason: 'Upgrade button missing or hidden.' };
      }

      if (upgradeBtn.disabled || upgradeBtn.classList.contains('disabled')) {
        return { success: false, reason: 'Upgrade button is disabled.' };
      }

      upgradeBtn.click();
      return { success: true };
    });

    if (upgradeResult.success) {
      console.log(`[BUILD ENGINE] Successfully triggered upgrade for ${task.name}!`);
      await new Promise(r => setTimeout(r, 2000));
      return true;
    } else {
      console.warn(`[BUILD ENGINE] Upgrade failed: ${upgradeResult.reason}`);
      await frame.evaluate(() => {
        const exitBtn = document.querySelector('#ExitUpgradeMenu, .closeModal, .modalClose');
        if (exitBtn) exitBtn.click();
      });
      return false;
    }

  } catch (err) {
    console.error(`[BUILD ENGINE ERROR] Execution exception:`, err.message);
    return false;
  }
}

async function executeResearchUpgrade(frame, task) {
  try {
    console.log(`[RESEARCH ENGINE] Opening Science Center for research task: ${task.name}`);

    // Step 1: Check if Science Center window is already open
    let isOpen = await frame.evaluate(() => {
      const scienceModal = document.querySelector('#mod_science, #modal_science, #science_center, .scienceWindow, #modal_building');
      return scienceModal && window.getComputedStyle(scienceModal).display !== 'none';
    });

    if (!isOpen) {
      console.log('[RESEARCH ENGINE] Finding Science Center on city grid...');
      const opened = await frame.evaluate(() => {
        const slots = Array.from(document.querySelectorAll('.buildingSlot, .building, [data-building-type], div[id*="building"], .slot, a, button'));
        const scienceBuilding = slots.find(el => {
          const txt = (el.textContent || '').toLowerCase();
          return txt.includes('science center') || txt.includes('science');
        });

        if (scienceBuilding) {
          scienceBuilding.click();
          return true;
        }
        return false;
      });

      if (!opened) {
        console.warn('[RESEARCH ENGINE] Could not locate Science Center on current city view.');
        return false;
      }

      await new Promise(r => setTimeout(r, 2500));
    }

    // Step 2: Trigger Research technology inside Science Center modal
    console.log(`[RESEARCH ENGINE] Locating technology: ${task.name}`);
    const researchResult = await frame.evaluate((techName) => {
      const rows = Array.from(document.querySelectorAll('.researchRow, .techRow, tr, div[id*="tech"], .techItem, .researchItem'));

      const targetRow = rows.find(r => {
        const txt = (r.textContent || '').toLowerCase();
        return txt.includes(techName.toLowerCase());
      });

      if (!targetRow) {
        return { success: false, reason: 'Technology not found in Science Center window.' };
      }

      const researchBtn = targetRow.querySelector('button, .btnResearch, .btnUpgrade, a.button, input[type="button"], #upgrade');

      if (!researchBtn) {
        return { success: false, reason: 'Research button missing or not visible for this tech.' };
      }

      if (researchBtn.disabled || researchBtn.classList.contains('disabled')) {
        return { success: false, reason: 'Research button disabled (Prerequisites missing or queue active).' };
      }

      researchBtn.click();
      return { success: true };
    }, task.name);

    if (researchResult.success) {
      console.log(`[RESEARCH ENGINE] Successfully started research for ${task.name}!`);
      await new Promise(r => setTimeout(r, 2000));
      return true;
    } else {
      console.warn(`[RESEARCH ENGINE] Research trigger failed: ${researchResult.reason}`);
      await frame.evaluate(() => {
        const closeBtn = document.querySelector('#mod_science .close, #modal_science .close, .closeModal, .modalClose, #ExitUpgradeMenu');
        if (closeBtn) closeBtn.click();
      });
      return false;
    }

  } catch (err) {
    console.error(`[RESEARCH ENGINE ERROR] Execution exception:`, err.message);
    return false;
  }
}

// ==========================================
// 4. AUTHENTICATION ENGINE
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

  try {
    console.log('[BOT LOGIN] Navigating to login page...');
    if (!page.url().includes('index.html')) {
      await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await new Promise(r => setTimeout(r, 2000));

    console.log('[BOT LOGIN] Checking for modal trigger...');
    await page.evaluate(() => {
      const btn = document.querySelector('button[popovertarget="login-modal-wrapper"], button.login-button, #loginButton');
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 1500));

    const emailSelector = '#login-email';
    const passwordSelector = '#login-password';
    const submitBtnSelector = '#pain1';

    console.log('[BOT LOGIN] Waiting for input fields...');
    await page.waitForSelector(emailSelector, { visible: true, timeout: 10000 }).catch(() => {
      console.warn('[BOT LOGIN WARNING] Email selector timeout - attempting direct injection...');
    });

    await page.evaluate((u, p, eSel, pSel) => {
      const eInput = document.querySelector(eSel) || document.querySelector('input[type="email"]');
      const pInput = document.querySelector(pSel) || document.querySelector('input[type="password"]');
      if (eInput) eInput.value = u;
      if (pInput) pInput.value = p;
    }, email, password, emailSelector, passwordSelector);

    console.log('[BOT LOGIN] Submitting login credentials...');
    
    await page.evaluate((btnSel) => {
      const btn = document.querySelector(btnSel) || document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
    }, submitBtnSelector);

    await new Promise(r => setTimeout(r, 5000));

    console.log('[BOT LOGIN] Navigating directly to game page...');
    await page.goto(CONFIG.gameUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const finalUrl = page.url();
    const isSuccess = finalUrl.includes('Great.html');
    console.log(`[BOT LOGIN] Result: ${isSuccess ? 'SUCCESS' : 'FAILED'} (Current URL: ${finalUrl})`);

    return isSuccess;
  } catch (err) {
    console.error('[DIAGNOSTIC ERROR] Login flow failed:', err.message);
    return false;
  } finally {
    state.isLoggingIn = false;
  }
}

// ==========================================
// 5. QUEUE LOGIC & POLLING ENGINE
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
        !!(document.querySelector('#OpenBar') || document.querySelector('.constructionItem') || document.querySelector('.buildingSlot') || document.querySelector('#mod_science') || document.querySelector('#modal_science'))
      );
      if (frameHasTarget) return frame;
    } catch (e) {}
  }

  return null;
}

async function processQueueLoop() {
  if (state.isProcessing || state.isLoggingIn || !state.page) return;
  state.isProcessing = true;

  try {
    if (state.page.isClosed()) throw new Error('Page context closed.');

    const targetContext = await getGameFrame(state.page);
    if (!targetContext) return;

    await ensureConstructionDrawerOpen(state.page);

    const drawerQueues = await targetContext.evaluate(scrapeCategorizedDrawer);
    if (drawerQueues) {
      state.activeQueues = drawerQueues;
    }

    // --- Process Building Tasks ---
    const nextBuildTaskIndex = state.pendingTasks.findIndex(t => t.type === 'build');
    const isBuildingBusy = state.activeQueues.construction && state.activeQueues.construction.length > 0;

    if (nextBuildTaskIndex !== -1 && !isBuildingBusy) {
      const task = state.pendingTasks[nextBuildTaskIndex];
      const success = await executeBuildingUpgrade(targetContext, task);

      if (success) {
        state.pendingTasks.splice(nextBuildTaskIndex, 1);
        console.log(`[BOT] Building task executed and cleared:`, task);
      }
    }

    // --- Process Research Tasks ---
    const nextResearchTaskIndex = state.pendingTasks.findIndex(t => t.type === 'research');
    const isResearchBusy = state.activeQueues.research && state.activeQueues.research.length > 0;

    if (nextResearchTaskIndex !== -1 && !isResearchBusy) {
      const task = state.pendingTasks[nextResearchTaskIndex];
      const success = await executeResearchUpgrade(targetContext, task);

      if (success) {
        state.pendingTasks.splice(nextResearchTaskIndex, 1);
        console.log(`[BOT] Research task executed and cleared:`, task);
      }
    }

  } catch (err) {
    console.error('[BOT] Polling error:', err.message);
  } finally {
    state.isProcessing = false;
  }
}

// ==========================================
// 6. INITIALIZATION
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
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1280,800'
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
