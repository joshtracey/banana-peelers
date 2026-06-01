const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby5j3c-2KMmbowB691VLgFD5D1nmtYSX2ACNt-r6y8RjlJYcUDnwIpIm9jV83Sn80oe/exec';

const Sync = {
  pollInterval: null,
  lastSyncTime: null,
  isSyncing: false,

  async fetchAll() {
    const url = APPS_SCRIPT_URL + '?action=getAll&t=' + Date.now();
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  },

  async post(payload) {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      mode: 'cors'
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  },

  async saveGame(game) {
    this.localSaveGames(STATE.games);
    try {
      await this.post({ type: 'saveGame', game });
    } catch (e) {
      console.warn('saveGame sync failed (local saved):', e.message);
    }
  },

  async saveLineChange(gameId, lines, coach) {
    try {
      await this.post({ type: 'saveLineChange', gameId, lines, coach });
    } catch (e) {
      console.warn('saveLineChange sync failed:', e.message);
    }
  },

  async importGameSheet(gameNo) {
    return this.post({ type: 'parseGameSheet', gameNo: parseInt(gameNo) });
  },

  async saveReflection(gameId, coach, reflection, lineNotes, statsUrl) {
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    if (coach === 'Coach1') {
      game.reflectionCoach1 = reflection;
      game.lineNotesCoach1 = lineNotes;
    } else {
      game.reflectionCoach2 = reflection;
      game.lineNotesCoach2 = lineNotes;
    }
    if (statsUrl) game.statsUrl = statsUrl;
    this.localSaveGames(STATE.games);
    try {
      await this.post({ type: 'saveReflection', gameId, coach, reflection, lineNotes, statsUrl });
    } catch (e) {
      console.warn('saveReflection sync failed (local saved):', e.message);
    }
  },

  localSaveGames(games) {
    try {
      localStorage.setItem('bp_games', JSON.stringify(games));
    } catch (e) {}
  },

  localLoadGames() {
    try {
      const raw = localStorage.getItem('bp_games');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  async loadAll() {
    this.setSyncStatus('loading');
    const localGames = this.localLoadGames();
    if (localGames) {
      STATE.games = localGames;
      ensureSchedule();
      renderAll();
    }
    try {
      const data = await this.fetchAll();
      if (data && data.games && data.games.length > 0) {
        // Don't blow away a game already active from localStorage
        if (!STATE.activeGameId) {
          STATE.games = data.games;
          ensureSchedule();
          this.localSaveGames(STATE.games);
          renderAll();
        }
      } else if (!localGames) {
        ensureSchedule();
        renderAll();
      }
      this.lastSyncTime = Date.now();
      this.setSyncStatus('ok');
    } catch (e) {
      console.warn('Backend unavailable, using local data:', e.message);
      if (!localGames) {
        ensureSchedule();
        renderAll();
      }
      this.setSyncStatus('offline');
    }
  },

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      try {
        const data = await this.fetchAll();
        if (data && data.games && data.games.length > 0) {
          // Preserve any game that is actively being managed locally
          const merged = data.games.map(remoteGame => {
            if (remoteGame.id === STATE.activeGameId) {
              return STATE.games.find(g => g.id === STATE.activeGameId) || remoteGame;
            }
            return remoteGame;
          });
          const localStr = JSON.stringify(STATE.games);
          const mergedStr = JSON.stringify(merged);
          if (localStr !== mergedStr) {
            STATE.games = merged;
            ensureSchedule();
            this.localSaveGames(STATE.games);
            // Don't re-render the Today tab while a game is being managed
            if (!STATE.activeGameId) renderAll();
          }
          this.lastSyncTime = Date.now();
          this.setSyncStatus('ok');
        }
      } catch (e) {
        this.setSyncStatus('offline');
      } finally {
        this.isSyncing = false;
      }
    }, 15000);

    setInterval(() => this.updateSyncAge(), 5000);
  },

  setSyncStatus(state) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    if (state === 'loading') {
      el.textContent = 'Syncing...';
      el.className = 'sync-status';
    } else if (state === 'ok') {
      el.textContent = 'Synced';
      el.className = 'sync-status ok';
    } else if (state === 'offline') {
      el.textContent = 'Offline';
      el.className = 'sync-status error';
    }
  },

  updateSyncAge() {
    if (!this.lastSyncTime) return;
    const el = document.getElementById('sync-status');
    if (!el || el.className.includes('error')) return;
    const secs = Math.round((Date.now() - this.lastSyncTime) / 1000);
    if (secs < 5) {
      el.textContent = 'Synced just now';
    } else if (secs < 60) {
      el.textContent = `Synced ${secs}s ago`;
    } else {
      el.textContent = `Synced ${Math.round(secs / 60)}m ago`;
    }
  }
};
