const Heatmap = {
  render() {
    const el = document.getElementById('heatmap-content');
    const roster = getRoster().filter(p => p.position !== 'G');
    const pairSection = hmRenderPairs(STATE.games, roster);
    const lineSection = hmRenderLines(STATE.games, roster);

    if (!pairSection && !lineSection) {
      el.innerHTML = '<div class="loading-state">Import game stats to see chemistry data.</div>';
      return;
    }
    el.innerHTML = (pairSection || '') + (lineSection || '');
  }
};

function hmAbbrev(players) {
  const firstCount = {};
  players.forEach(p => {
    const f = p.name.split(' ')[0];
    firstCount[f] = (firstCount[f] || 0) + 1;
  });
  const out = {};
  players.forEach(p => {
    const parts = p.name.split(' ');
    const first = parts[0];
    out[p.id] = firstCount[first] > 1 ? first + ' ' + parts[parts.length - 1][0] : first;
  });
  return out;
}

function hmHeatColor(count, max) {
  if (!count) return { bg: 'var(--grey-100)', fg: 'var(--grey-400)' };
  const t = count / max;
  if (t <= 0.3)  return { bg: '#fff9c4', fg: 'var(--navy-dark)' };
  if (t <= 0.6)  return { bg: 'var(--yellow)', fg: 'var(--navy-dark)' };
  if (t <= 0.85) return { bg: 'var(--yellow-dark)', fg: 'var(--navy-dark)' };
  return { bg: 'var(--navy)', fg: 'var(--yellow)' };
}

function hmRenderPairs(games, roster) {
  const pairCounts = {};
  const involvedIds = new Set();

  games.forEach(game => {
    if (!game.scoring) return;
    game.scoring.forEach(goal => {
      const ids = [goal.scorer, goal.assist1, goal.assist2]
        .filter(n => n != null)
        .map(num => { const p = roster.find(r => r.number === num); return p ? p.id : null; })
        .filter(Boolean);
      ids.forEach(id => involvedIds.add(id));
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = [ids[i], ids[j]].sort().join(':');
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
      }
    });
  });

  const players = roster.filter(p => involvedIds.has(p.id));
  if (!players.length) return '';

  const abbrev = hmAbbrev(players);
  const maxCount = Math.max(...Object.values(pairCounts), 1);

  const colHeaders = players.map(p =>
    `<th class="hm-col-header"><div class="hm-col-label">${abbrev[p.id]}</div></th>`
  ).join('');

  const bodyRows = players.map((rp, ri) => {
    const cells = players.map((cp, ci) => {
      if (ri === ci) return `<td class="hm-cell hm-diag"></td>`;
      const key = [rp.id, cp.id].sort().join(':');
      const count = pairCounts[key] || 0;
      const { bg, fg } = hmHeatColor(count, maxCount);
      return `<td class="hm-cell" style="background:${bg};color:${fg}">${count || ''}</td>`;
    }).join('');
    return `<tr><th class="hm-row-header">${abbrev[rp.id]}</th>${cells}</tr>`;
  }).join('');

  return `
    <div class="section-title" style="margin-bottom:6px">Pair Chemistry</div>
    <p class="text-muted" style="font-size:12px;margin-bottom:10px">Times two players appeared on the same scoring play</p>
    <div class="hm-scroll">
      <table class="hm-table">
        <thead><tr><th></th>${colHeaders}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div class="hm-legend">
      <span class="hm-swatch" style="background:var(--grey-100)"></span>0
      <span class="hm-swatch" style="background:#fff9c4"></span>low
      <span class="hm-swatch" style="background:var(--yellow)"></span>mid
      <span class="hm-swatch" style="background:var(--navy)"></span>high
    </div>
    <hr class="divider">
  `;
}

function hmRenderLines(games, roster) {
  const lineMap = {};

  games.forEach(game => {
    if (!game.lines || !game.scoring || !game.scoring.length) return;
    game.lines.forEach(line => {
      const members = [...(line.forwards || []), ...(line.defence || [])].filter(Boolean);
      if (members.length < 2) return;
      const memberSet = new Set(members);
      let pts = 0;
      game.scoring.forEach(goal => {
        [goal.scorer, goal.assist1, goal.assist2].forEach(num => {
          if (num == null) return;
          const p = roster.find(r => r.number === num);
          if (p && memberSet.has(p.id)) pts++;
        });
      });
      if (!pts) return;
      const key = members.slice().sort().join(':');
      if (!lineMap[key]) lineMap[key] = { members, pts: 0, games: 0 };
      lineMap[key].pts += pts;
      lineMap[key].games++;
    });
  });

  const lines = Object.values(lineMap).sort((a, b) => b.pts - a.pts);
  if (!lines.length) return '';

  const maxPts = lines[0].pts;

  const rows = lines.map(entry => {
    const names = entry.members.map(id => {
      const p = roster.find(r => r.id === id);
      return p ? p.name.split(' ')[0] : id;
    }).join(', ');
    const w = Math.round((entry.pts / maxPts) * 100);
    const gLabel = entry.games === 1 ? '1 game' : `${entry.games} games`;
    return `
      <div class="hm-line-row">
        <div class="hm-line-meta">
          <div class="hm-line-names">${names}</div>
          <div class="hm-line-sub">${gLabel}</div>
        </div>
        <div class="hm-line-right">
          <div class="hm-line-bar-wrap">
            <div class="hm-line-bar" style="width:${w}%"></div>
          </div>
          <div class="hm-line-pts">${entry.pts} pts</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="section-title" style="margin-bottom:6px">Line Points</div>
    <p class="text-muted" style="font-size:12px;margin-bottom:12px">Total goals + assists by line composition</p>
    ${rows}
  `;
}
