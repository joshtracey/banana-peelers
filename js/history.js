// History tab — past games, reflections, retroactive entry
const History = {
  filterPlayerId: null,
  expandedGameId: null,
  pendingRetroGameId: null,

  render() {
    const el = document.getElementById('history-content');
    const allGames = STATE.games.slice().reverse(); // newest first
    const filtered = this.filterPlayerId
      ? allGames.filter(g => g.attendance && g.attendance.includes(this.filterPlayerId))
      : allGames;

    const roster = getRoster();
    const skaters = getSkaters();

    const filterChips = `
      <div class="history-filter">
        <button class="filter-chip ${!this.filterPlayerId ? 'active' : ''}"
          onclick="History.setFilter(null)">All Games</button>
        ${skaters.map(p => `
          <button class="filter-chip ${this.filterPlayerId === p.id ? 'active' : ''}"
            onclick="History.setFilter('${p.id}')">
            ${firstName(p)}
          </button>`).join('')}
      </div>`;

    if (filtered.length === 0) {
      el.innerHTML = filterChips + '<div class="loading-state">No games found.</div>';
      return;
    }

    el.innerHTML = filterChips + filtered.map(g => this.gameCard(g)).join('');
  },

  setFilter(playerId) {
    this.filterPlayerId = playerId;
    this.render();
  },

  gameCard(game) {
    const isExpanded = this.expandedGameId === game.id;
    const hasLines = game.lines && game.lines.length > 0 && game.lines.some(l =>
      l.forwards.some(Boolean) || l.defence.some(Boolean)
    );
    const isActive = game.isActive;
    const badgeClass = isActive ? 'active' : game.isRetroactive ? 'retroactive' : game.completed ? 'completed' : 'upcoming';
    const badgeText = isActive ? 'Active' : game.isRetroactive ? 'Retro' : game.completed ? 'Done' : 'Upcoming';

    return `
      <div class="history-game-card" id="hcard-${game.id}">
        <div class="history-card-header" onclick="History.toggle('${game.id}')">
          <div class="history-card-main">
            <div class="history-card-opponent">
              vs ${game.opponent}
              <span class="game-badge ${badgeClass}" style="font-size:10px;padding:2px 6px;vertical-align:middle">${badgeText}</span>
            </div>
            <div class="history-card-meta">
              <span>${formatDate(game.date)}</span>
              <span>·</span>
              <span>${game.time}</span>
              <span>·</span>
              <span>${game.venue}</span>
            </div>
          </div>
          <div class="history-card-right">
            ${game.result ? `<span class="history-card-result">${game.result}</span>` : ''}
            <span class="history-card-chevron ${isExpanded ? 'open' : ''}">▼</span>
          </div>
        </div>
        <div class="history-card-body ${isExpanded ? 'open' : ''}" id="hbody-${game.id}">
          ${this.gameBody(game, hasLines)}
        </div>
      </div>`;
  },

  gameBody(game, hasLines) {
    const roster = getRoster();
    let html = '';

    // Attendance
    if (game.attendance && game.attendance.length > 0) {
      const names = game.attendance.map(id => {
        const p = roster.find(r => r.id === id);
        return p ? firstName(p) : id;
      }).join(', ');
      html += `
        <div class="section-title" style="margin-bottom:4px">Attendance (${game.attendance.length})</div>
        <div class="text-muted" style="font-size:14px;margin-bottom:12px">${names}</div>`;
      if (!game.goaliePresent) {
        html += `<div class="text-muted" style="font-size:13px;margin-bottom:8px">⚠️ Goalie absent${game.goalieFillIn ? ' — Fill-in: ' + game.goalieFillIn : ''}</div>`;
      }
    }

    // Lines
    if (hasLines) {
      html += `<div class="section-title" style="margin-bottom:8px">Lines${game.isRetroactive ? '<span class="retroactive-badge">Retroactive</span>' : ''}</div>`;
      html += '<div class="history-lines-display">';
      game.lines.forEach((line, idx) => {
        const forwards = line.forwards.filter(Boolean).map(id => {
          const p = roster.find(r => r.id === id);
          return p ? `<span class="history-player-tag f">${firstName(p)}</span>` : '';
        }).join('');
        const defence = line.defence.filter(Boolean).map(id => {
          const p = roster.find(r => r.id === id);
          return p ? `<span class="history-player-tag d">${firstName(p)}</span>` : '';
        }).join('');
        if (!forwards && !defence) return;
        html += `
          <div class="history-line-row">
            <span class="history-line-label">Line ${idx + 1}</span>
            ${forwards}${defence}
          </div>`;
      });
      html += '</div>';
    } else {
      html += `
        <div style="margin-bottom:12px">
          <div class="text-muted" style="margin-bottom:8px">No line data yet.</div>
          <button class="btn btn-outline btn-sm" onclick="History.openRetroactive('${game.id}')">
            ✏️ Add Lines
          </button>
        </div>`;
    }

    // Reflections
    const c1 = game.reflectionCoach1;
    const c2 = game.reflectionCoach2;
    const lineNotes1 = game.lineNotesCoach1;
    const lineNotes2 = game.lineNotesCoach2;

    if (c1 || c2) {
      html += `<hr class="divider"><div class="section-title" style="margin-bottom:8px">Reflections</div>`;
      if (c1) html += `
        <div class="reflection-block">
          <div class="reflection-coach-label">Coach 1 (Russell)</div>
          <div class="reflection-text">${escHtml(c1)}</div>
          ${lineNotes1 ? `<div class="reflection-text" style="margin-top:6px;font-style:italic">${escHtml(lineNotes1)}</div>` : ''}
        </div>`;
      if (c2) html += `
        <div class="reflection-block">
          <div class="reflection-coach-label">Coach 2 (Josh)</div>
          <div class="reflection-text">${escHtml(c2)}</div>
          ${lineNotes2 ? `<div class="reflection-text" style="margin-top:6px;font-style:italic">${escHtml(lineNotes2)}</div>` : ''}
        </div>`;
    }

    // Stats link
    if (game.statsUrl) {
      html += `<a class="stats-link" href="${game.statsUrl}" target="_blank">📊 View Stats →</a>`;
    } else {
      html += `
        <a class="stats-link" href="https://saintjohnballhockey.com/results/?seasonNo=5&teamNo=41" target="_blank">
          📊 View All Results →
        </a>`;
    }

    // Stats table (if imported)
    if (game.playerStats && game.playerStats.length > 0) {
      html += `<hr class="divider">` + renderStatsTable(game);
    }

    // Actions
    html += '<div class="game-actions" style="margin-top:12px">';
    html += `<button class="btn btn-secondary btn-sm" onclick="History.openReflection('${game.id}')">
      ✍️ Add / Edit Reflection
    </button>`;
    html += `<button class="btn btn-outline btn-sm" onclick="showImportModal('${game.id}')">
      📊 ${game.playerStats && game.playerStats.length ? 'Re-import Stats' : 'Import Game Stats'}
    </button>`;
    if (!hasLines) {
      html += `<button class="btn btn-outline btn-sm" onclick="History.openRetroactive('${game.id}')">
        ✏️ Add Lines Retroactively
      </button>`;
    }
    html += '</div>';

    return html;
  },

  toggle(gameId) {
    if (this.expandedGameId === gameId) {
      this.expandedGameId = null;
    } else {
      this.expandedGameId = gameId;
    }
    this.render();
  },

  openReflection(gameId) {
    STATE.activeReflectionGameId = gameId;
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    const coach = STATE.coach;
    const currentText = coach === 'Coach1' ? (game.reflectionCoach1 || '') : (game.reflectionCoach2 || '');
    const currentLineNotes = coach === 'Coach1' ? (game.lineNotesCoach1 || '') : (game.lineNotesCoach2 || '');
    document.getElementById('reflection-text').value = currentText;
    document.getElementById('stats-url-input').value = game.statsUrl || '';

    const lnContainer = document.getElementById('line-notes-container');
    lnContainer.innerHTML = '';
    if (game.lines && game.lines.length) {
      game.lines.forEach((line, idx) => {
        const key = `line-note-${line.id}`;
        const existingNote = (game[`lineNote_${line.id}_${coach}`] || '');
        lnContainer.innerHTML += `
          <div class="line-note-group">
            <div class="line-note-label">Line ${idx + 1}</div>
            <input type="text" class="line-note-input" id="${key}"
              placeholder="Notes for Line ${idx + 1}"
              value="${escAttr(existingNote)}">
          </div>`;
      });
    }

    document.getElementById('reflection-modal').classList.remove('hidden');
  },

  openRetroactive(gameId) {
    this.pendingRetroGameId = gameId;
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    document.getElementById('retroactive-game-info').textContent =
      `${formatDate(game.date)} vs ${game.opponent}`;
    document.getElementById('retroactive-modal').classList.remove('hidden');
  }
};

function openRetroactive() {
  const gameId = History.pendingRetroGameId;
  if (!gameId) return;
  closeModal('retroactive-modal');
  const game = STATE.games.find(g => g.id === gameId);
  if (!game) return;
  game.isRetroactive = true;
  game.isActive = true;
  if (!game.attendance || game.attendance.length === 0) {
    game.attendance = getSkaters().map(p => p.id);
    game.goaliePresent = true;
  }
  if (!game.lines || game.lines.length === 0) {
    game.lines = Lines.defaultLines(game.attendance);
  }
  Sync.localSaveGames(STATE.games);
  switchTab('today');
  STATE.activeGameId = gameId;
  renderTodayTab();
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function escAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).slice(0, 10);
  const d = new Date(clean + 'T12:00:00');
  if (isNaN(d.getTime())) return clean;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
}
