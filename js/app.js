// ── Global state ──
const STATE = {
  coach: null,
  games: [],
  activeGameId: null,
  activeReflectionGameId: null,
  pendingImportGameId: null,
  pendingImportData: null,
  currentTab: 'today'
};

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', () => {
  const savedCoach = localStorage.getItem('bp_coach');
  if (savedCoach) {
    STATE.coach = savedCoach;
    showApp();
  } else {
    document.getElementById('coach-modal').classList.remove('hidden');
  }

  document.querySelectorAll('.btn-coach').forEach(btn => {
    btn.addEventListener('click', () => selectCoach(btn.dataset.coach));
  });
});

function selectCoach(coach) {
  STATE.coach = coach;
  localStorage.setItem('bp_coach', coach);
  document.getElementById('coach-modal').classList.add('hidden');
  showApp();
}

function showApp() {
  document.getElementById('app').classList.remove('hidden');
  Sync.loadAll().then(() => {
    Sync.startPolling();
  });
}

// ── Ensure all scheduled games exist in STATE.games ──
function ensureSchedule() {
  const roster = getRoster();
  SCHEDULE.forEach(sched => {
    const existing = STATE.games.find(g => g.id === sched.id);
    if (!existing) {
      STATE.games.push({
        id: sched.id,
        date: sched.date,
        opponent: sched.opponent,
        time: sched.time,
        venue: sched.venue,
        result: sched.result,
        completed: sched.completed,
        isActive: false,
        isRetroactive: false,
        goaliePresent: true,
        goalieFillIn: null,
        attendance: [],
        lines: [],
        finalLines: [],
        reflectionCoach1: '',
        reflectionCoach2: '',
        lineNotesCoach1: '',
        lineNotesCoach2: '',
        statsUrl: ''
      });
    } else {
      // Sync schedule metadata in case it changed
      if (!existing.opponent) existing.opponent = sched.opponent;
      if (!existing.time) existing.time = sched.time;
      if (!existing.venue) existing.venue = sched.venue;
      if (existing.result === undefined) existing.result = sched.result;
    }
  });
  // Sort by date
  STATE.games.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Tab switching ──
function switchTab(tab) {
  STATE.currentTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'today') renderTodayTab();
  if (tab === 'history') History.render();
  if (tab === 'roster') renderRosterTab();
}

// ── Render all ──
function renderAll() {
  if (STATE.currentTab === 'today') renderTodayTab();
  if (STATE.currentTab === 'history') History.render();
  if (STATE.currentTab === 'roster') renderRosterTab();
}

// ── Today tab ──
function renderTodayTab() {
  const today = todayStr();
  const allGames = STATE.games;

  // Active game takes priority
  const activeGame = STATE.activeGameId
    ? allGames.find(g => g.id === STATE.activeGameId)
    : allGames.find(g => g.isActive);

  if (activeGame) {
    STATE.activeGameId = activeGame.id;
    renderGameManagement(activeGame);
    document.getElementById('save-fab').classList.remove('hidden');
    return;
  }

  document.getElementById('save-fab').classList.add('hidden');

  // Find next upcoming game
  const upcoming = allGames.filter(g => !g.isActive);
  const future = upcoming.filter(g => g.date >= today);
  const nextGame = future[0] || upcoming[upcoming.length - 1];
  const recentPast = allGames.filter(g => g.date < today).reverse();

  let html = '';

  // Next game
  if (nextGame) {
    const isToday = nextGame.date === today;
    html += `
      <div class="game-header-card">
        <div class="game-header-top">
          <span class="game-date">${formatDate(nextGame.date)} · ${nextGame.time}</span>
          <span class="game-badge ${isToday ? 'active' : 'upcoming'}">${isToday ? 'Today!' : 'Next Game'}</span>
        </div>
        <div class="game-opponent">vs ${nextGame.opponent}</div>
        <div class="game-meta">
          <span>${nextGame.venue}</span>
        </div>
      </div>
      <div class="game-actions">
        <button class="btn btn-yellow" onclick="promptStartGame('${nextGame.id}')">
          🏒 Manage This Game
        </button>
      </div>`;
  }

  // Upcoming schedule
  const upcomingList = future.slice(1);
  if (upcomingList.length > 0) {
    html += `<div class="section-header" style="margin-top:24px;margin-bottom:8px">
      <span class="section-title">Upcoming (${upcomingList.length})</span>
    </div>`;
    html += upcomingList.map(g => `
      <div class="schedule-game-item">
        <div class="schedule-game-date">${formatDateShort(g.date)}</div>
        <div class="schedule-game-info">
          <div class="schedule-game-opponent">vs ${g.opponent}</div>
          <div class="schedule-game-meta">${g.time} · ${g.venue}</div>
        </div>
        <button class="schedule-game-action" onclick="promptStartGame('${g.id}')">Manage</button>
      </div>`).join('');
  }

  // Recent past
  const recentGames = recentPast.slice(0, 3);
  if (recentGames.length > 0) {
    html += `<div class="section-header" style="margin-top:24px;margin-bottom:8px">
      <span class="section-title">Recent Games</span>
    </div>`;
    html += recentGames.map(g => {
      const hasLines = g.lines && g.lines.some(l => l.forwards.some(Boolean) || l.defence.some(Boolean));
      return `
        <div class="schedule-game-item">
          <div class="schedule-game-date">${formatDateShort(g.date)}</div>
          <div class="schedule-game-info">
            <div class="schedule-game-opponent">vs ${g.opponent}${g.result ? ` · <strong>${g.result}</strong>` : ''}</div>
            <div class="schedule-game-meta">${g.venue}</div>
          </div>
          <button class="schedule-game-action" onclick="History.openRetroactive('${g.id}'); switchTab('history')">
            ${hasLines ? 'View' : '+ Lines'}
          </button>
        </div>`;
    }).join('');
  }

  html += `<div style="height:24px"></div>
    <div class="text-muted" style="text-align:center;font-size:12px">
      Signed in as ${STATE.coach === 'Coach1' ? 'Russell (Coach 1)' : 'Josh (Coach 2)'} ·
      <button style="color:var(--navy);font-size:12px;text-decoration:underline" onclick="switchCoach()">Switch</button>
    </div>`;

  document.getElementById('today-content').innerHTML = html;
}

function renderGameManagement(game) {
  const roster = getRoster();
  const skaters = getSkaters();
  const goalie = getGoalie();
  const isRetro = game.isRetroactive;

  // Ensure attendance defaults
  if (!game.attendance || game.attendance.length === 0) {
    game.attendance = skaters.map(p => p.id);
    game.goaliePresent = true;
    Sync.localSaveGames(STATE.games);
  }

  const forwards = skaters.filter(p => p.position === 'F');
  const defence = skaters.filter(p => p.position === 'D');

  const attendanceChips = (players, label) => players.map(p => {
    const present = game.attendance.includes(p.id);
    return `
      <div class="attendance-chip ${present ? 'present' : 'absent'}"
        onclick="toggleAttendance('${game.id}', '${p.id}')">
        <span class="chip-number">#${p.number}</span>
        ${p.name.split(' ')[0]}
        <span class="chip-pos">${p.position}</span>
      </div>`;
  }).join('');

  const goalieBanner = goalie ? `
    <div class="goalie-banner ${game.goaliePresent ? '' : 'warning'}">
      <span class="goalie-banner-text">
        ${game.goaliePresent ? `✅ Goalie: ${goalie.name}` : `⚠️ Goalie absent`}
      </span>
      <button class="btn btn-sm btn-secondary" onclick="toggleGoalie('${game.id}')">
        ${game.goaliePresent ? 'Mark Absent' : 'Mark Present'}
      </button>
      ${!game.goaliePresent ? `
        <select onchange="setGoalieFillIn('${game.id}', this.value)">
          <option value="">Assign fill-in...</option>
          ${game.attendance.map(id => {
            const p = roster.find(r => r.id === id);
            return p ? `<option value="${p.name}" ${game.goalieFillIn === p.name ? 'selected' : ''}>${p.name}</option>` : '';
          }).join('')}
        </select>` : ''}
    </div>` : '';

  // Ensure lines exist — only auto-fill when there are genuinely no line objects at all
  const hasLineObjects = game.lines && game.lines.length > 0;
  if (!hasLineObjects) {
    game.lines = Lines.defaultLines(game.attendance);
    Sync.localSaveGames(STATE.games);
  }

  const html = `
    <div class="game-header-card">
      <div class="game-header-top">
        <span class="game-date">${formatDate(game.date)} · ${game.time}</span>
        <span class="game-badge ${isRetro ? 'retroactive' : 'active'}">${isRetro ? 'Retroactive' : 'Active'}</span>
      </div>
      <input class="game-opponent-input" type="text"
        value="${escAttr(game.opponent)}"
        placeholder="vs Opponent"
        onchange="updateOpponent('${game.id}', this.value)">
      <div class="game-meta">
        <span>${game.venue}</span>
        <span>${STATE.coach === 'Coach1' ? 'Russell' : 'Josh'}</span>
      </div>
    </div>

    ${goalieBanner}
    ${renderStatsBar(game)}

    <div class="attendance-section">
      <div class="section-header">
        <span class="section-title">Attendance</span>
        <button class="btn btn-sm btn-secondary" onclick="toggleAllAttendance('${game.id}')">Toggle All</button>
      </div>
      <div class="attendance-grid">
        ${attendanceChips(forwards, 'Forwards')}
        ${attendanceChips(defence, 'Defence')}
      </div>
    </div>

    <div class="line-builder-section">
      <div class="section-header" style="margin-bottom:8px">
        <span class="section-title">Lines</span>
      </div>
      <div id="line-builder-${game.id}"></div>
    </div>

    <hr class="divider">
    <div class="game-actions">
      <button class="btn btn-primary" onclick="History.openReflection('${game.id}')">
        ✍️ Add Reflection
      </button>
      <button class="btn btn-outline" onclick="finishGame('${game.id}')">
        ✅ Finish Game
      </button>
    </div>
    <div style="height:80px"></div>`;

  document.getElementById('today-content').innerHTML = html;
  Lines.render(game.id);
}

// ── Game actions ──
function promptStartGame(gameId) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;

  // Find most recent game with lines for copy-forward
  const gamesWithLines = STATE.games.filter(g =>
    g.id !== gameId && g.lines && g.lines.some(l => l.forwards.some(Boolean) || l.defence.some(Boolean))
  );
  const lastGame = gamesWithLines[gamesWithLines.length - 1];

  if (lastGame) {
    const msg = `Copy lines from ${formatDate(lastGame.date)} vs ${lastGame.opponent}?`;
    document.getElementById('copy-modal-message').textContent = msg;
    document.getElementById('copy-forward-btn').dataset.fromGameId = lastGame.id;
    document.getElementById('copy-forward-btn').dataset.toGameId = gameId;
    document.getElementById('copy-modal').classList.remove('hidden');
  } else {
    startFreshGame(gameId);
  }
}

function copyForward() {
  const btn = document.getElementById('copy-forward-btn');
  const fromId = btn.dataset.fromGameId;
  const toId = btn.dataset.toGameId;
  closeModal('copy-modal');

  const fromGame = STATE.games.find(g => g.id === fromId);
  const toGame = STATE.games.find(g => g.id === toId);
  if (!fromGame || !toGame) return;

  const skaters = getSkaters();
  if (!toGame.attendance || toGame.attendance.length === 0) {
    toGame.attendance = skaters.map(p => p.id);
    toGame.goaliePresent = true;
  }

  toGame.lines = Lines.copyForward(fromGame.lines, toGame.attendance);
  toGame.isActive = true;
  STATE.activeGameId = toId;
  Sync.localSaveGames(STATE.games);
  renderTodayTab();
}

function startFresh() {
  const btn = document.getElementById('copy-forward-btn');
  const toId = btn.dataset.toGameId;
  closeModal('copy-modal');
  startFreshGame(toId);
}

function startFreshGame(gameId) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  const skaters = getSkaters();
  game.attendance = skaters.map(p => p.id);
  game.goaliePresent = true;
  game.lines = Lines.defaultLines(game.attendance);
  game.isActive = true;
  STATE.activeGameId = gameId;
  Sync.localSaveGames(STATE.games);
  renderTodayTab();
}

function finishGame(gameId) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  game.finalLines = JSON.parse(JSON.stringify(game.lines));
  game.isActive = false;
  STATE.activeGameId = null;
  Sync.saveGame(game);
  renderTodayTab();
}

function saveSnapshot() {
  const game = STATE.games.find(g => g.id === STATE.activeGameId);
  if (!game) return;
  const snapshot = JSON.parse(JSON.stringify(game.lines));
  Sync.saveLineChange(game.id, snapshot, STATE.coach);
  const fab = document.getElementById('save-fab');
  fab.textContent = '✅ Saved!';
  setTimeout(() => { fab.textContent = '💾 Save Snapshot'; }, 2000);
}

// ── Attendance ──
function toggleAttendance(gameId, playerId) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  const idx = game.attendance.indexOf(playerId);
  if (idx === -1) {
    game.attendance.push(playerId);
  } else {
    game.attendance.splice(idx, 1);
    // Remove from lines
    Lines.removePlayerFromAllSlots(game, playerId);
  }
  Sync.saveGame(game);
  renderGameManagement(game);
  Lines.render(gameId);
}

function toggleAllAttendance(gameId) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  const skaters = getSkaters();
  const allPresent = skaters.every(p => game.attendance.includes(p.id));
  game.attendance = allPresent ? [] : skaters.map(p => p.id);
  if (allPresent) game.lines = [];
  Sync.saveGame(game);
  renderGameManagement(game);
}

function toggleGoalie(gameId) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  game.goaliePresent = !game.goaliePresent;
  if (game.goaliePresent) game.goalieFillIn = null;
  Sync.saveGame(game);
  renderGameManagement(game);
}

function setGoalieFillIn(gameId, name) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  game.goalieFillIn = name;
  Sync.saveGame(game);
}

function updateOpponent(gameId, value) {
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  game.opponent = value;
  Sync.saveGame(game);
}

// ── Reflections ──
function saveReflection() {
  const gameId = STATE.activeReflectionGameId;
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;

  const text = document.getElementById('reflection-text').value.trim();
  const statsUrl = document.getElementById('stats-url-input').value.trim();

  const lineNoteInputs = document.querySelectorAll('.line-note-input');
  const lineNotes = [];
  lineNoteInputs.forEach((inp, idx) => {
    if (inp.value.trim()) lineNotes.push(`Line ${idx + 1}: ${inp.value.trim()}`);
  });
  const lineNotesStr = lineNotes.join('\n');

  Sync.saveReflection(gameId, STATE.coach, text, lineNotesStr, statsUrl);
  closeModal('reflection-modal');

  if (STATE.currentTab === 'history') History.render();
}

// ── Modals ──
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── Helpers ──
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).slice(0, 10);
  const d = new Date(clean + 'T12:00:00');
  if (isNaN(d.getTime())) return clean;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function switchCoach() {
  if (confirm('Switch coach? This will reload the page.')) {
    localStorage.removeItem('bp_coach');
    location.reload();
  }
}

// ── Stats import ──

function renderStatsBar(game) {
  if (game.playerStats && game.playerStats.length > 0) {
    const total = game.playerStats.reduce((s, p) => s + p.g, 0);
    return `
      <div class="stats-imported-bar">
        <span>📊 Game #${game.gameNo} · ${total} goals imported</span>
        <button class="btn btn-sm btn-secondary" onclick="showImportModal('${game.id}')">Re-import</button>
      </div>
      ${renderStatsTable(game)}`;
  }
  return `<button class="import-btn" onclick="showImportModal('${game.id}')">
    📊 Import Game Stats
  </button>`;
}

function renderStatsTable(game) {
  if (!game.playerStats || !game.playerStats.length) return '';
  const roster = getRoster();
  const rows = game.playerStats
    .slice()
    .sort((a, b) => b.pts - a.pts || b.g - a.g)
    .map(s => {
      const player = roster.find(p => p.number === s.number);
      const nameParts = player ? player.name.split(' ') : [];
      const name = player
        ? nameParts[0] + (nameParts[1] ? ' ' + nameParts[1][0] + '.' : '')
        : '#' + s.number;
      return `<tr>
        <td>${name}</td>
        <td>${s.g}</td>
        <td>${s.a}</td>
        <td class="pts-col">${s.pts}</td>
      </tr>`;
    }).join('');
  return `
    <table class="stats-table" style="margin-bottom:16px">
      <thead><tr><th>Player</th><th>G</th><th>A</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function showImportModal(gameId) {
  STATE.pendingImportGameId = gameId;
  STATE.pendingImportData = null;
  const game = STATE.games.find(g => g.id === gameId);
  document.getElementById('game-no-input').value = game && game.gameNo ? game.gameNo : '';
  document.getElementById('import-results').innerHTML = '';
  document.getElementById('import-footer').classList.add('hidden');
  document.getElementById('import-fetch-btn').textContent = 'Fetch';
  document.getElementById('import-fetch-btn').disabled = false;
  document.getElementById('import-modal').classList.remove('hidden');
}

async function doImport() {
  const gameNo = document.getElementById('game-no-input').value.trim();
  if (!gameNo) return;

  const btn = document.getElementById('import-fetch-btn');
  btn.textContent = 'Fetching…';
  btn.disabled = true;
  document.getElementById('import-results').innerHTML =
    '<div class="loading-state" style="padding:16px 0">Fetching game sheet from Shark system…</div>';
  document.getElementById('import-footer').classList.add('hidden');

  try {
    const data = await Sync.importGameSheet(gameNo);
    if (data.error) {
      document.getElementById('import-results').innerHTML =
        `<p style="color:var(--red);margin-top:12px">${escHtml(data.error)}</p>`;
    } else {
      STATE.pendingImportData = data;
      renderImportPreview(data);
      document.getElementById('import-footer').classList.remove('hidden');
    }
  } catch (e) {
    document.getElementById('import-results').innerHTML =
      `<p style="color:var(--red);margin-top:12px">Could not reach Apps Script. Check your connection.</p>`;
  } finally {
    btn.textContent = 'Fetch';
    btn.disabled = false;
  }
}

function renderImportPreview(data) {
  const roster = getRoster();
  const rows = data.playerStats
    .slice()
    .sort((a, b) => b.pts - a.pts || b.g - a.g)
    .map(s => {
      const player = roster.find(p => p.number === s.number);
      const name = player ? player.name : (s.name || '#' + s.number);
      return `<tr>
        <td>${name}</td>
        <td>${s.g}</td>
        <td>${s.a}</td>
        <td class="pts-col">${s.pts}</td>
      </tr>`;
    }).join('');

  const seenPreviewIds = new Set();
  const attendNames = (data.roster || [])
    .map(r => matchRosterEntry(r, roster))
    .filter(p => p && !seenPreviewIds.has(p.id) && seenPreviewIds.add(p.id))
    .map(p => p.name.split(' ')[0])
    .join(', ');

  document.getElementById('import-results').innerHTML = `
    <hr class="divider">
    <div class="section-title" style="margin-bottom:8px">
      ${data.totalGoals} goals · Game #${data.gameNo}
    </div>
    <table class="stats-table">
      <thead><tr><th>Player</th><th>G</th><th>A</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${attendNames ? `
    <div style="margin-top:12px">
      <div class="form-label">Attendance (from sheet)</div>
      <div class="text-muted" style="font-size:13px">${attendNames}</div>
    </div>` : ''}
    ${data.debugScoring ? `
    <hr class="divider">
    <div class="form-label" style="margin-bottom:4px">Debug — scoring lines</div>
    <textarea readonly style="width:100%;height:120px;font-size:11px;font-family:monospace;white-space:pre">${escHtml(data.debugScoring)}</textarea>` : ''}`;
}

function matchRosterEntry(r, roster) {
  if (r.number != null) {
    const byNum = roster.find(p => p.number === r.number);
    if (byNum) {
      // Validate last name to filter out opponent players with the same jersey number
      if (r.name) {
        const rLast = r.name.trim().split(/\s+/).pop().toLowerCase();
        const pLast = byNum.name.trim().split(/\s+/).pop().toLowerCase();
        if (rLast === pLast) return byNum;
      } else {
        return byNum;
      }
    }
  }
  if (r.name) {
    const rName = r.name.toLowerCase().replace(/\s+/g, ' ').trim();
    return roster.find(p => p.name.toLowerCase().replace(/\s+/g, ' ').trim() === rName) || null;
  }
  return null;
}

function confirmImport() {
  const game = STATE.games.find(g => g.id === STATE.pendingImportGameId);
  if (!game || !STATE.pendingImportData) return;

  const data = STATE.pendingImportData;
  game.gameNo = data.gameNo;
  game.playerStats = data.playerStats;
  game.scoring = data.scoring;

  // Auto-update attendance from game sheet roster
  if (data.roster && data.roster.length > 0) {
    const roster = getRoster();
    const seenIds = new Set();
    const presentIds = data.roster
      .map(r => matchRosterEntry(r, roster))
      .filter(p => p && !seenIds.has(p.id) && seenIds.add(p.id))
      .map(p => p.id);
    if (presentIds.length > 0) game.attendance = presentIds;
    game.goaliePresent = data.roster.some(r => {
      const p = matchRosterEntry(r, roster);
      return p && p.position === 'G';
    });
  }

  Sync.saveGame(game);
  closeModal('import-modal');

  // Re-render wherever we are
  if (STATE.activeGameId === game.id) {
    renderGameManagement(game);
  } else if (STATE.currentTab === 'history') {
    History.render();
  }
}

// ── Modal backdrop close ──
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && !e.target.id !== 'coach-modal') {
    e.target.classList.add('hidden');
  }
});
