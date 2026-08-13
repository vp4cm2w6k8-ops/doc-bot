/**
 * Dragons of Camelot - Multi-City Queue Engine
 */
(function () {
  'use strict';

  // State tracker for queue processing
  const QueueEngine = {
    pollIntervalMs: 5000, // Check queue state every 5 seconds
    pendingBuilds: [],   // Managed build targets: { location: 'Water', name: 'Camp', targetLevel: 10 }
    intervalId: null
  };

  /**
   * 1. DOM SCRAPER & PARSER
   */
  function getActiveConstructionQueue() {
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

      // Isolate duration string by cloning and dropping location span
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
        timeLeftSeconds: parseTimeToSeconds(rawTimeText),
        speedUpType: speedUpEl ? speedUpEl.getAttribute('data-speedup-type') : null,
        progressPercent: progressBar ? parseFloat(progressBar.style.width) : 0
      });
    });

    return activeQueue;
  }

  /**
   * Helper: Converts "38h 12m 51s" format to seconds
   */
  function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    let totalSeconds = 0;
    const h = timeStr.match(/(\d+)\s*h/i);
    const m = timeStr.match(/(\d+)\s*m/i);
    const s = timeStr.match(/(\d+)\s*s/i);

    if (h) totalSeconds += parseInt(h[1], 10) * 3600;
    if (m) totalSeconds += parseInt(m[1], 10) * 60;
    if (s) totalSeconds += parseInt(s[1], 10);

    return totalSeconds;
  }

  /**
   * 2. CITY STATUS CHECKERS
   */
  function isCityBusy(activeQueue, locationName) {
    return activeQueue.some(
      (item) => item.location.toLowerCase() === locationName.toLowerCase()
    );
  }

  /**
   * 3. BUILD EXECUTION HANDLER
   * Triggers the build action in-game when a queue slot becomes available
   */
  function executeBuildCommand(buildTask) {
    console.log(`[BOT] Starting build: ${buildTask.name} Lvl ${buildTask.targetLevel} in ${buildTask.location}`);
    
    // Example: Dispatching build request or clicking UI target element
    // Switch to city iframe context or fire game API call:
    // Modal/API execution logic goes here...
  }

  /**
   * 4. MAIN QUEUE POLLING LOOP
   */
  function processQueueLoop() {
    const activeQueue = getActiveConstructionQueue();
    console.log(`[BOT] Active jobs running: ${activeQueue.length}`, activeQueue);

    // Filter pending targets against currently busy cities
    for (let i = QueueEngine.pendingBuilds.length - 1; i >= 0; i--) {
      const task = QueueEngine.pendingBuilds[i];

      if (!isCityBusy(activeQueue, task.location)) {
        console.log(`[BOT] Open construction slot detected in ${task.location}!`);
        executeBuildCommand(task);
        
        // Remove task from pending queue after launching
        QueueEngine.pendingBuilds.splice(i, 1);
      } else {
        console.log(`[BOT] ${task.location} is currently busy. Waiting for slot to free up.`);
      }
    }
  }

  /**
   * 5. INITIALIZATION & PUBLIC CONTROLS
   */
  window.QueueManager = {
    start: function () {
      if (QueueEngine.intervalId) return;
      console.log('[BOT] Starting Multi-City Queue Engine polling...');
      QueueEngine.intervalId = setInterval(processQueueLoop, QueueEngine.pollIntervalMs);
    },
    stop: function () {
      if (QueueEngine.intervalId) {
        clearInterval(QueueEngine.intervalId);
        QueueEngine.intervalId = null;
        console.log('[BOT] Queue Engine stopped.');
      }
    },
    addBuildTask: function (location, name, targetLevel) {
      QueueEngine.pendingBuilds.push({ location, name, targetLevel });
      console.log(`[BOT] Added target to queue: ${name} (Level ${targetLevel}) in ${location}`);
    },
    getActiveStatus: function () {
      return getActiveConstructionQueue();
    }
  };

  // Auto-start polling engine
  window.QueueManager.start();
})();
