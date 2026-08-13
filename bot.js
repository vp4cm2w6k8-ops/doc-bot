const puppeteer = require('puppeteer');
const express = require('express');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// --- ROBUST URL SANITIZER ---
function sanitizeUrl(rawUrl) {
    let url = (rawUrl || 'https://www.dragonsofcamelot.com').trim();
    
    // Strip markdown links if present (e.g. [text](https://example.com))
    const mdMatch = url.match(/\[.*?\]\((.*?)\)/);
    if (mdMatch) {
        url = mdMatch[1].trim();
    }
    
    // Clean up duplicate protocol prefixes (e.g., https://https://)
    url = url.replace(/^(https?:\/\/)+/gi, '');
    
    return 'https://' + url;
}

// --- CONFIGURATION ---
const CONFIG = {
    gameUrl: sanitizeUrl(process.env.GAME_URL),
    username: process.env.GAME_USER || 'YOUR_EMAIL@EXAMPLE.COM',
    password: process.env.GAME_PASSWORD || 'YOUR_PASSWORD',
    pollIntervalMs: 15000
};

// --- IN-MEMORY QUEUE DATA STORE ---
let queuePlan = [
    { id: 1, type: 'building', name: 'Academy', level: 5 },
    { id: 2, type: 'building', name: 'Cottage', level: 8 },
    { id: 3, type: 'research', name: 'Dragon Breeding', level: 3 }
];

let activeStatus = {
    buildingQueue: 'Idle',
    researchQueue: 'Idle',
    lastCheck: 'Starting up...'
};

// --- WEB DASHBOARD UI ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dragons of Camelot - Queue Controller</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
            h2 { text-align: center; color: #4caf50; margin-bottom: 20px; }
            .status-box { background: #2a2a2a; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #4caf50; }
            .form-group { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
            select, input, button { padding: 10px; border-radius: 6px; border: 1px solid #333; background: #2c2c2c; color: #fff; font-size: 14px; }
            select { flex: 2; }
            input[type="number"] { width: 70px; }
            button { background: #4caf50; color: white; font-weight: bold; border: none; cursor: pointer; flex: 1; min-width: 100px; }
            button:hover { background: #45a049; }
            .queue-list { list-style: none; padding: 0; }
            .queue-item { display: flex; justify-content: space-between; align-items: center; background: #2a2a2a; margin-bottom: 8px; padding: 10px 14px; border-radius: 6px; }
            .queue-item.research { border-left: 4px solid #2196f3; }
            .queue-item.building { border-left: 4px solid #ff9800; }
            .btn-del { background: #f44336; padding: 6px 10px; font-size: 12px; min-width: auto; }
            .tag { font-size: 10px; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: #444; margin-right: 8px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Queue Control Center</h2>
            <div class="status-box">
                <div><strong>Building Queue:</strong> <span id="bStatus">Loading...</span></div>
                <div><strong>Research Queue:</strong> <span id="rStatus">Loading...</span></div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">Last check: <span id="lastCheck">-</span></div>
            </div>

            <div class="form-group">
                <select id="qType">
                    <option value="building">Building Upgrade</option>
                    <option value="research">Research Tech</option>
                </select>
                <input type="text" id="qName" placeholder="Name (e.g., Academy)" style="flex:2;" />
                <input type="number" id="qLevel" placeholder="Lvl" value="1" min="1" max="25" />
                <button onclick="addItem()">Add to Queue</button>
            </div>

            <h3>Upcoming Upgrades</h3>
            <ul id="queueList" class="queue-list"></ul>
        </div>

        <script>
            async function loadData() {
                const res = await fetch('/api/state');
                const data = await res.json();
                document.getElementById('bStatus').innerText = data.status.buildingQueue;
                document.getElementById('rStatus').innerText = data.status.researchQueue;
                document.getElementById('lastCheck').innerText = data.status.lastCheck;

                const list = document.getElementById('queueList');
                list.innerHTML = '';
                data.queue.forEach((item) => {
                    list.innerHTML += \`
                        <li class="queue-item \${item.type}">
                            <div>
                                <span class="tag">\${item.type}</span>
                                <strong>\${item.name}</strong> (Target Lvl \${item.level})
                            </div>
                            <button class="btn-del" onclick="removeItem(\${item.id})">Delete</button>
                        </li>
                    \`;
                });
            }

            async function addItem() {
                const type = document.getElementById('qType').value;
                const name = document.getElementById('qName').value.trim();
                const level = parseInt(document.getElementById('qLevel').value);
                if (!name) return alert('Please enter a name');

                await fetch('/api/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, name, level })
                });
                document.getElementById('qName').value = '';
                loadData();
            }

            async function removeItem(id) {
                await fetch('/api/queue/' + id, { method: 'DELETE' });
                loadData();
            }

            setInterval(loadData, 5000);
            loadData();
        </script>
    </body>
    </html>
    `);
});

// --- API ENDPOINTS FOR THE UI ---
app.get('/api/state', (req, res) => res.json({ queue: queuePlan, status: activeStatus }));

app.post('/api/queue', (req, res) => {
    const { type, name, level } = req.body;
    const newItem = { id: Date.now(), type, name, level: parseInt(level) };
    queuePlan.push(newItem);
    res.json({ success: true, item: newItem });
});

app.delete('/api/queue/:id', (req, res) => {
    const id = parseInt(req.params.id);
    queuePlan = queuePlan.filter(item => item.id !== id);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`[HTTP SERVER] Control Dashboard live on port ${PORT}`));

// --- HELPER FUNCTIONS ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getGameFrame(page) {
    for (const frame of page.frames()) {
        try {
            const hasSeed = await frame.evaluate(() => typeof window.seed !== 'undefined' || typeof window.Modal !== 'undefined');
            if (hasSeed) return frame;
        } catch (e) {
            // Ignore cross-origin frame access restriction errors
        }
    }
    return null;
}

async function checkSlotBusy(frame, type) {
    return await frame.evaluate((qType) => {
        if (qType === 'building') {
            const container = document.querySelector('#TimeContainer');
            return container ? container.querySelectorAll('.constructionItem').length > 0 : false;
        } else {
            const container = document.querySelector('#TimeContainerResearch');
            return container ? container.querySelectorAll('.constructionItem').length > 0 : false;
        }
    }, type);
}

async function executeUpgrade(frame, item) {
    return await frame.evaluate((target) => {
        try {
            if (target.type === 'building') {
                if (window.seed && window.seed.buildings) {
                    const cityId = window.currentCityId || 1;
                    const cityBuildings = window.seed.buildings[`city${cityId}`];
                    
                    if (cityBuildings) {
                        for (const key in cityBuildings) {
                            const b = cityBuildings[key];
                            if (b && b.name && b.name.toLowerCase() === target.name.toLowerCase()) {
                                if (typeof window.Modal !== 'undefined' && window.Modal.show) {
                                    window.Modal.show('building', { buildingId: b.id, slotId: b.slot });
                                    return true;
                                }
                            }
                        }
                    }
                }

                const nodes = Array.from(document.querySelectorAll('.buildingTile, .buildingItem, .modal-item'));
                const match = nodes.find(n => n.innerText.toLowerCase().includes(target.name.toLowerCase()));
                if (match) {
                    match.click();
                    const upgradeBtn = document.querySelector('#btnUpgrade, .btn_upgrade, .buildUpgradeBtn');
                    if (upgradeBtn) {
                        upgradeBtn.click();
                        return true;
                    }
                }
            } else if (target.type === 'research') {
                if (typeof window.Modal !== 'undefined' && window.Modal.show) {
                    window.Modal.show('academy');
                }

                const researchNodes = Array.from(document.querySelectorAll('.researchTile, .researchItem, #researchList .item'));
                const match = researchNodes.find(r => r.innerText.toLowerCase().includes(target.name.toLowerCase()));
                if (match) {
                    match.click();
                    const researchBtn = document.querySelector('#btnResearch, .btn_research');
                    if (researchBtn) {
                        researchBtn.click();
                        return true;
                    }
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }, item);
}

// --- AUTOMATION ENGINE ---
async function startQueueBot() {
    console.log('[BOT] Launching Headless Browser Engine...');
    console.log(`[BOT] Target URL set to: ${CONFIG.gameUrl}`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        console.log('[BOT] Navigating to game portal...');
        await page.goto(CONFIG.gameUrl, { waitUntil: 'networkidle2' });

        // --- LOGIN HANDLER FOR DRAGONSOFCAMELOT.COM MODAL ---
        try {
            const emailSel = '#login-email';
            const passSel = '#login-password';

            const emailInput = await page.$(emailSel);
            if (emailInput) {
                console.log('[BOT] Login modal detected. Filling credentials...');
                
                await emailInput.click({ clickCount: 3 });
                await emailInput.type(CONFIG.username, { delay: 50 });

                const passInput = await page.$(passSel);
                await passInput.click({ clickCount: 3 });
                await passInput.type(CONFIG.password, { delay: 50 });

                console.log('[BOT] Submitting login form...');
                await Promise.all([
                    page.click('form#login-form button[type="submit"]'),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
                ]);
                console.log('[BOT] Login submitted successfully.');
            } else {
                console.log('[BOT] Login modal not visible, proceeding assuming active session.');
            }
        } catch (err) {
            console.log('[BOT] Login attempt error:', err.message);
        }

        console.log('[BOT] Waiting for Game Frame initialization...');
        let targetFrame = null;
        for (let i = 0; i < 12; i++) {
            targetFrame = await getGameFrame(page);
            if (targetFrame) break;
            await sleep(3000);
        }

        if (!targetFrame) {
            console.error('[BOT ERROR] Could not locate active game iframe context.');
            return;
        }

        console.log('[BOT] Game context hooked successfully.');

        while (true) {
            activeStatus.lastCheck = new Date().toLocaleTimeString();

            // 1. Evaluate Building Queue
            const buildingBusy = await checkSlotBusy(targetFrame, 'building');
            activeStatus.buildingQueue = buildingBusy ? 'Busy (Upgrading)' : 'Idle';

            if (!buildingBusy) {
                const nextBuilding = queuePlan.find(item => item.type === 'building');
                if (nextBuilding) {
                    console.log(`[BOT] Attempting Building: ${nextBuilding.name} Lvl ${nextBuilding.level}`);
                    const success = await executeUpgrade(targetFrame, nextBuilding);
                    if (success) {
                        queuePlan = queuePlan.filter(i => i.id !== nextBuilding.id);
                        activeStatus.buildingQueue = 'Upgrade Triggered!';
                    }
                }
            }

            // 2. Evaluate Research Queue
            const researchBusy = await checkSlotBusy(targetFrame, 'research');
            activeStatus.researchQueue = researchBusy ? 'Busy (Researching)' : 'Idle';

            if (!researchBusy) {
                const nextResearch = queuePlan.find(item => item.type === 'research');
                if (nextResearch) {
                    console.log(`[BOT] Attempting Research: ${nextResearch.name} Lvl ${nextResearch.level}`);
                    const success = await executeUpgrade(targetFrame, nextResearch);
                    if (success) {
                        queuePlan = queuePlan.filter(i => i.id !== nextResearch.id);
                        activeStatus.researchQueue = 'Research Triggered!';
                    }
                }
            }

            await sleep(CONFIG.pollIntervalMs);
        }
    } catch (err) {
        console.error('[BOT ERROR]', err);
    }
}

startQueueBot();
