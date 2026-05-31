// Lines module — handles line builder UI and state
const Lines = {
  selectedPlayerId: null,
  dragSourceGameId: null,
  dragSourceSlot: null,

  emptyLines(numLines) {
    const lines = [];
    for (let i = 0; i < numLines; i++) {
      lines.push({ id: 'line-' + (i + 1), forwards: [null, null], defence: [null, null] });
    }
    return lines;
  },

  defaultLines(presentIds) {
    const roster = getRoster();
    const forwards = presentIds.filter(id => {
      const p = roster.find(r => r.id === id);
      return p && p.position === 'F';
    });
    const defence = presentIds.filter(id => {
      const p = roster.find(r => r.id === id);
      return p && p.position === 'D';
    });
    const numLines = Math.max(3, Math.ceil(Math.max(forwards.length, defence.length) / 2));
    const lines = this.emptyLines(numLines);
    for (let i = 0; i < forwards.length; i++) {
      const lineIdx = i % numLines;
      const slotIdx = Math.floor(i / numLines);
      if (slotIdx < 2) lines[lineIdx].forwards[slotIdx] = forwards[i];
    }
    for (let i = 0; i < defence.length; i++) {
      const lineIdx = i % numLines;
      const slotIdx = Math.floor(i / numLines);
      if (slotIdx < 2) lines[lineIdx].defence[slotIdx] = defence[i];
    }
    return lines;
  },

  copyForward(prevLines, presentIds) {
    const roster = getRoster();
    const lines = JSON.parse(JSON.stringify(prevLines));
    lines.forEach(line => {
      line.forwards = line.forwards.map(id => presentIds.includes(id) ? id : null);
      line.defence = line.defence.map(id => presentIds.includes(id) ? id : null);
    });
    return lines;
  },

  getAssigned(game) {
    const assigned = new Set();
    (game.lines || []).forEach(line => {
      [...line.forwards, ...line.defence].forEach(id => { if (id) assigned.add(id); });
    });
    return assigned;
  },

  getUnassigned(game) {
    const assigned = this.getAssigned(game);
    const skaters = getSkaters();
    return (game.attendance || []).filter(id => {
      const p = skaters.find(s => s.id === id);
      return p && !assigned.has(id);
    });
  },

  isComplete(line) {
    return line.forwards.filter(Boolean).length === 2 && line.defence.filter(Boolean).length === 2;
  },

  render(gameId) {
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    const container = document.getElementById('line-builder-' + gameId);
    if (!container) return;
    container.innerHTML = this.buildHTML(game);
    this.attachEvents(gameId);
  },

  buildHTML(game) {
    const unassigned = this.getUnassigned(game);
    const roster = getRoster();
    const lines = game.lines || [];

    const poolHTML = unassigned.length === 0
      ? `<div class="player-pool-empty">✅ All players assigned</div>`
      : `<div class="pool-chips">${unassigned.map(id => {
          const p = roster.find(r => r.id === id);
          if (!p) return '';
          const cls = p.position === 'F' ? 'forward' : 'defence';
          const sel = this.selectedPlayerId === id ? ' selected' : '';
          return `<div class="player-chip ${cls}${sel}"
            data-player-id="${id}"
            data-game-id="${game.id}"
            draggable="true"
            onclick="Lines.selectPlayer('${id}', '${game.id}')">
            <span class="chip-num">#${p.number}</span>${p.name}
          </div>`;
        }).join('')}</div>`;

    const linesHTML = lines.map((line, idx) => {
      const complete = this.isComplete(line);
      return `
        <div class="line-card" id="line-card-${line.id}">
          <div class="line-card-header">
            <span class="line-card-title">Line ${idx + 1}</span>
            <span class="line-complete-badge ${complete ? 'complete' : 'incomplete'}">
              ${complete ? '✓ Full' : 'Needs players'}
            </span>
          </div>
          <div class="line-card-body">
            <div class="line-slots-row">
              <span class="line-slots-label">F</span>
              <div class="line-slots-group">
                ${this.slotHTML(game.id, line.id, 'forwards', 0, line.forwards[0], 'slot-f', 'F')}
                ${this.slotHTML(game.id, line.id, 'forwards', 1, line.forwards[1], 'slot-f', 'F')}
              </div>
            </div>
            <div class="line-slots-row">
              <span class="line-slots-label">D</span>
              <div class="line-slots-group">
                ${this.slotHTML(game.id, line.id, 'defence', 0, line.defence[0], 'slot-d', 'D')}
                ${this.slotHTML(game.id, line.id, 'defence', 1, line.defence[1], 'slot-d', 'D')}
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    const canRemove = lines.length > 1;
    const actionsHTML = `
      <div class="line-actions">
        <button class="btn-add-line" onclick="Lines.addLine('${game.id}')">+ Add Line</button>
        ${canRemove ? `<button class="btn-remove-line" onclick="Lines.removeLine('${game.id}')">Remove Last</button>` : ''}
      </div>`;

    return `
      <div class="section-header">
        <span class="section-title">Player Pool</span>
        <span class="text-muted" style="font-size:12px">${unassigned.length} unassigned</span>
      </div>
      <div class="player-pool">${poolHTML}</div>
      <div class="section-header" style="margin-bottom:8px">
        <span class="section-title">Lines</span>
      </div>
      ${linesHTML}
      ${actionsHTML}`;
  },

  slotHTML(gameId, lineId, group, idx, playerId, slotClass, pos) {
    const roster = getRoster();
    const highlightClass = this.selectedPlayerId
      ? (() => {
          if (playerId) return '';
          const sel = roster.find(r => r.id === this.selectedPlayerId);
          if (!sel) return '';
          return (pos === 'F' && sel.position === 'F') || (pos === 'D' && sel.position === 'D') ? ' highlight' : '';
        })()
      : '';
    if (playerId) {
      const player = roster.find(r => r.id === playerId);
      const name = player ? player.name.split(' ')[0] : '?';
      const num = player ? '#' + player.number : '';
      return `
        <div class="slot ${slotClass} filled${highlightClass}"
          data-game-id="${gameId}" data-line-id="${lineId}" data-group="${group}" data-idx="${idx}"
          onclick="Lines.slotClick('${gameId}', '${lineId}', '${group}', ${idx})"
          draggable="true">
          <div class="slot-filled-content">
            <span class="slot-filled-num">${num}</span>
            <span class="slot-filled-name">${name}</span>
            <span class="slot-filled-remove" onclick="event.stopPropagation(); Lines.removeFromSlot('${gameId}','${lineId}','${group}',${idx})">×</span>
          </div>
        </div>`;
    }
    return `
      <div class="slot ${slotClass}${highlightClass}"
        data-game-id="${gameId}" data-line-id="${lineId}" data-group="${group}" data-idx="${idx}"
        onclick="Lines.slotClick('${gameId}', '${lineId}', '${group}', ${idx})">
        <span class="slot-placeholder">${pos === 'F' ? '🏒' : '🛡️'}</span>
      </div>`;
  },

  selectPlayer(playerId, gameId) {
    if (this.selectedPlayerId === playerId) {
      this.selectedPlayerId = null;
    } else {
      this.selectedPlayerId = playerId;
    }
    this.render(gameId);
  },

  slotClick(gameId, lineId, group, idx) {
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    const line = game.lines.find(l => l.id === lineId);
    if (!line) return;
    const currentOccupant = line[group][idx];

    if (this.selectedPlayerId) {
      // Check position compatibility
      const roster = getRoster();
      const sel = roster.find(r => r.id === this.selectedPlayerId);
      if (sel) {
        const expectedPos = group === 'forwards' ? 'F' : 'D';
        if (sel.position !== expectedPos) {
          // Allow it — coaches can override positions
        }
      }
      // If slot occupied, send occupant back to pool (remove from line)
      if (currentOccupant) {
        this.removePlayerFromAllSlots(game, currentOccupant);
      }
      // Remove selected player from wherever they currently are
      this.removePlayerFromAllSlots(game, this.selectedPlayerId);
      // Assign
      line[group][idx] = this.selectedPlayerId;
      this.selectedPlayerId = null;
    } else if (currentOccupant) {
      // No player selected — select the occupant
      this.selectedPlayerId = currentOccupant;
      this.removeFromSlot(gameId, lineId, group, idx);
      this.render(gameId);
      return;
    }
    this.saveAndRender(game);
  },

  removeFromSlot(gameId, lineId, group, idx) {
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    const line = game.lines.find(l => l.id === lineId);
    if (!line) return;
    line[group][idx] = null;
    this.saveAndRender(game);
  },

  removePlayerFromAllSlots(game, playerId) {
    (game.lines || []).forEach(line => {
      line.forwards = line.forwards.map(id => id === playerId ? null : id);
      line.defence = line.defence.map(id => id === playerId ? null : id);
    });
  },

  addLine(gameId) {
    const game = STATE.games.find(g => g.id === gameId);
    if (!game) return;
    const newIdx = (game.lines || []).length + 1;
    game.lines.push({ id: 'line-' + newIdx, forwards: [null, null], defence: [null, null] });
    this.saveAndRender(game);
  },

  removeLine(gameId) {
    const game = STATE.games.find(g => g.id === gameId);
    if (!game || game.lines.length <= 1) return;
    // Move players from last line back to unassigned (they stay in attendance)
    game.lines.pop();
    this.saveAndRender(game);
  },

  saveAndRender(game) {
    Sync.localSaveGames(STATE.games);
    Sync.saveGame(game);
    this.render(game.id);
  },

  attachEvents(gameId) {
    // Drag-and-drop for desktop
    const container = document.getElementById('line-builder-' + gameId);
    if (!container) return;

    container.querySelectorAll('[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', e => {
        const pid = el.dataset.playerId;
        const gid = el.dataset.gameId;
        const lineId = el.dataset.lineId;
        const group = el.dataset.group;
        const idx = el.dataset.idx;
        e.dataTransfer.setData('text/plain', JSON.stringify({ pid, gid, lineId, group, idx }));
        e.dataTransfer.effectAllowed = 'move';
      });
    });

    container.querySelectorAll('.slot').forEach(slot => {
      slot.addEventListener('dragover', e => {
        e.preventDefault();
        slot.classList.add('dragover');
      });
      slot.addEventListener('dragleave', () => {
        slot.classList.remove('dragover');
      });
      slot.addEventListener('drop', e => {
        e.preventDefault();
        slot.classList.remove('dragover');
        try {
          const src = JSON.parse(e.dataTransfer.getData('text/plain'));
          const destGameId = slot.dataset.gameId;
          const destLineId = slot.dataset.lineId;
          const destGroup = slot.dataset.group;
          const destIdx = parseInt(slot.dataset.idx);
          if (!destLineId || !destGroup || isNaN(destIdx)) return;

          const game = STATE.games.find(g => g.id === destGameId);
          if (!game) return;
          const destLine = game.lines.find(l => l.id === destLineId);
          if (!destLine) return;

          // Get player being dragged
          const pid = src.pid;
          const currentDest = destLine[destGroup][destIdx];

          // If dragged from a slot (not pool), swap
          if (src.lineId) {
            const srcLine = game.lines.find(l => l.id === src.lineId);
            if (srcLine) {
              const srcGroup = src.group;
              const srcIdx = parseInt(src.idx);
              srcLine[srcGroup][srcIdx] = currentDest;
            }
          } else {
            // From pool — remove from any current slot
            this.removePlayerFromAllSlots(game, pid);
          }
          destLine[destGroup][destIdx] = pid;
          this.saveAndRender(game);
        } catch (err) { console.warn('Drop error:', err); }
      });
    });
  }
};
