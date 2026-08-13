const express = require('express');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. HTTP HEALTH CHECK SERVER FOR RENDER
// ============================================================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Dragons of Camelot Headless Bot is Active.');
});

app.listen(PORT, () => {
    console.log(`[HTTP SERVER] Health endpoint listening on port ${PORT}`);
});

// ============================================================================
// 2. CONFIGURATION & CONSTANTS
// ============================================================================
const CONFIG = {
    // Game Credentials (Update or use environment variables)
    gameUrl: process.env.GAME_URL || 'https://www.dragonsofcamelot.com',
    username: process.env.BOT_USERNAME || 'YOUR_USERNAME_OR_EMAIL',
    password: process.env.BOT_PASSWORD || 'YOUR_PASSWORD',

    // Runtime Safety
    maxRuntimeMs: 4 * 60 * 60 * 1000, // 4 Hours safety limit per session

    // Target Lists
    DRAGON_NAMES: ['GreatDragon', 'LavaDragon', 'StoneDragon'] // Omits WaterDragon
};

const startTime = Date.now();
let waveCounter = 0;
let currentTargetIndex = 0;

// ============================================================================
// 3. HELPER FUNCTIONS
// ============================================================================
function getJitterDelay(baseDelay) {
    const variance = baseDelay * 0.20;
    const min = baseDelay - variance;
    const max = baseDelay + variance;
    return Math.floor(Math.random() * (max - min) + min);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateSSD(targetText, level) {
    const isCamp = /anthropus/i.test(targetText);

    if (isCamp) {
        if (level === 1 || level === 2) return 200;
        if (level === 3) return 600;
        if (level === 4) return 1250;
        if (level >= 5) return 3500;
        return 3500;
    } else {
        if (level >= 1 && level <= 3) return 200;
        if (level === 4) return 250;
        if (level === 5 || level === 6) return 600;
        if (level === 7) return 1000;
        if (level === 8 || level === 9) return 1700;
        if (level >= 10) return 7500;
        return 600;
    }
}

// ============================================================================
// 4. MAIN ENGINE
// ============================================================================
async function startBot() {
    console.log('[HEADLESS BOT] Launching browser engine...');
    
    // Server-container optimized Chrome launch arguments
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

   if (await page.$(usernameSelector)) {
            console.log('[HEADLESS BOT] Executing login sequence...');
            await page.type(usernameSelector, CONFIG.username, { delay: 50 });
            await page.type(passwordSelector, CONFIG.password, { delay: 50 });
            
            // Direct DOM click to bypass headless clickability checks
            await page.evaluate((btnSel) => {
                const btn = document.querySelector(btnSel);
                if (btn) {
                    btn.scrollIntoView();
                    btn.click();
                }
            }, loginBtnSelector);

            console.log('[HEADLESS BOT] Submitted credentials, waiting for game UI to load...');

            // Wait for SPA elements to appear instead of waiting for full page navigation
            try {
                await page.waitForSelector('#openBookmarksBtn, .map-container, #main_game_frame', { 
                    visible: true, 
                    timeout: 60000 
                });
                console.log('[HEADLESS BOT] Authentication completed & Game UI loaded successfully!');
            } catch (e) {
                console.warn('[HEADLESS BOT WARNING] Timed out waiting for UI selector. Attempting to proceed...');
            }
        } else {
            console.log('[HEADLESS BOT] Session already active / No login inputs detected.');
        }

        // Wait for main UI
        await page.waitForSelector('#openBookmarksBtn, .map-container', { timeout: 60000 });
        console.log('[HEADLESS BOT] Game state confirmed ready.');

        // Main Execution Loop
        while (Date.now() - startTime < CONFIG.maxRuntimeMs) {
            await executeLoopStep(page);
            await sleep(getJitterDelay(1200));
        }

        console.log('[HEADLESS BOT] Maximum runtime elapsed. Shutting down session.');

    } catch (err) {
        console.error('[HEADLESS BOT ERROR]', err);
    } finally {
        await browser.close();
    }
}

// ============================================================================
// 5. LOOP ACTIONS
// ============================================================================
async function executeLoopStep(page) {
    // Check general status
    const busyGeneral = await page.evaluate(() => {
        const disabledGeneralOption = document.querySelector('#generalSelectorContainer .general-option.disabled');
        if (disabledGeneralOption && disabledGeneralOption.textContent.toLowerCase().includes('all generals are busy')) {
            return true;
        }
        const optionNames = document.querySelectorAll('.general-option-name');
        for (const span of optionNames) {
            if (span.textContent.toLowerCase().includes('all generals are busy')) return true;
        }
        return false;
    });

    if (busyGeneral) {
        console.log('[GENERALS BUSY] All generals active. Waiting 15s...');
        await page.evaluate(() => {
            const closeBtn = document.querySelector('#closeAttackMenu, .close-button, .modal-close');
            if (closeBtn) closeBtn.click();
        });
        await sleep(15000);
        return;
    }

    // Check if Attack Dialog is open
    const isAttackDialogOpen = await page.evaluate(() => {
        const btn = document.querySelector('#attackButton');
        return btn && btn.style.display !== 'none';
    });

    if (isAttackDialogOpen) {
        const targetData = await page.evaluate((calcFnString) => {
            const nameEl = document.querySelector('#attackInfoName');
            if (!nameEl) return null;

            const targetText = nameEl.textContent.trim();
            const match = targetText.match(/\d+/);
            if (!match) return null;

            const level = parseInt(match[0], 10);
            const isCamp = /anthropus/i.test(targetText);
            
            const calcFunc = new Function('targetText', 'level', calcFnString);
            const requiredSSD = calcFunc(targetText, level);

            return { name: targetText, level, isCamp, requiredSSD };
        }, calculateSSD.toString().replace(/^function calculateSSD\(targetText, level\) \{|\}$/g, ''));

        if (!targetData) return;

        const targetSSD = targetData.requiredSSD;
        console.log(`[TARGET MATCH] ${targetData.name} | Lvl ${targetData.level} | Needs: ${targetSSD} SSD`);

        const availableTroops = await page.evaluate(() => {
            const wrapper = document.querySelector('.troop-card-wrapper[data-unit-name="SwiftStrikeDragon"]');
            return wrapper ? parseInt(wrapper.getAttribute('data-max-count'), 10) || 0 : 0;
        });

        if (availableTroops < targetSSD) {
            console.warn(`[RESOURCES LOW] ${availableTroops}/${targetSSD} SSD available. Cycling target...`);
            currentTargetIndex++;
            await page.evaluate(() => {
                const closeBtn = document.querySelector('#closeAttackMenu, .close-button, .modal-close');
                if (closeBtn) closeBtn.click();
            });
            await sleep(getJitterDelay(400));
            return;
        }

        // Fill Troop Input
        await page.evaluate((ssdCount) => {
            const wrapper = document.querySelector('.troop-card-wrapper[data-unit-name="SwiftStrikeDragon"]');
            if (wrapper) {
                const input = wrapper.querySelector('.troop-input');
                if (input) {
                    input.focus();
                    input.value = ssdCount.toString();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.blur();
                }
            }
        }, targetSSD);

        // Select Dragon for Wilderness
        if (!targetData.isCamp) {
            await page.evaluate((dragonList) => {
                for (const name of dragonList) {
                    const card = document.querySelector(`.troop-card-wrapper[data-unit-name="${name}"]`);
                    if (card) {
                        const count = parseInt(card.getAttribute('data-max-count'), 10) || 0;
                        if (count > 0) {
                            const input = card.querySelector('.troop-input');
                            if (input) {
                                input.focus();
                                input.value = "1";
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                input.blur();
                                break;
                            }
                        }
                    }
                }
            }, CONFIG.DRAGON_NAMES);
        }

        await sleep(getJitterDelay(300));

        // Dispatch March
        await page.evaluate(() => {
            const dispatchBtn = document.querySelector('#attackButton');
            if (dispatchBtn) dispatchBtn.click();
        });

        waveCounter++;
        currentTargetIndex++;
        console.log(`[DISPATCH SUCCESS] Wave #${waveCounter} dispatched!`);

        // Anti-Detection Pause Logic
        const wavesBeforeBreak = Math.floor(Math.random() * (22 - 12 + 1)) + 12;
        if (waveCounter % wavesBeforeBreak === 0) {
            const breakTime = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
            console.log(`[SIMULATED BREAK] Pausing for ${(breakTime / 1000).toFixed(1)}s...`);
            await sleep(breakTime);
        }

    } else {
        // Target selection sequence
        await page.evaluate(() => {
            const openBookBtn = document.querySelector('#openBookmarksBtn');
            if (openBookBtn) openBookBtn.click();
        });

        await sleep(getJitterDelay(400));

        const targetClicked = await page.evaluate((targetIdx) => {
            const rows = document.querySelectorAll('.tile-bookmark-row, tr[class*="bookmark"], div[class*="bookmark-row"]');
            if (rows.length === 0) return false;

            const rowIndex = targetIdx % rows.length;
            const targetRow = rows[rowIndex];

            if (targetRow) {
                const goBtn = Array.from(targetRow.querySelectorAll('button, a, input[type="button"]'))
                    .find(el => el.textContent.trim().toLowerCase() === 'go');

                if (goBtn) {
                    goBtn.click();
                    return true;
                }
            }
            return false;
        }, currentTargetIndex);

        if (targetClicked) {
            await sleep(getJitterDelay(500));
            await page.evaluate(() => {
                const mapAttackBtn = document.querySelector('button[onclick="attack()"]');
                if (mapAttackBtn) mapAttackBtn.click();
            });
            await sleep(getJitterDelay(500));
        } else {
            currentTargetIndex++;
        }
    }
}

// Start execution
startBot();
