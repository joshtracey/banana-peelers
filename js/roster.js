const DEFAULT_ROSTER = [
  { id: 'p86', number: 86, name: 'Max Fleming',     position: 'F' },
  { id: 'p63', number: 63, name: 'Jaxson Leaman',   position: 'F' },
  { id: 'p97', number: 97, name: 'Theodore Crabbe', position: 'F', preferred: 'Theo C' },
  { id: 'p87', number: 87, name: 'Theo Tracey',     position: 'F', preferred: 'Theo T' },
  { id: 'p71', number: 71, name: 'Norah Stevens',   position: 'F' },
  { id: 'p22', number: 22, name: 'Crawford Smith',  position: 'F' },
  { id: 'p73', number: 73, name: 'Grayson Conn',    position: 'D' },
  { id: 'p48', number: 48, name: 'Noah Watson',     position: 'D' },
  { id: 'p11', number: 11, name: 'Addison Train',   position: 'D' },
  { id: 'p10', number: 10, name: 'Adam Vyselaar',   position: 'D' },
  { id: 'p21', number: 21, name: 'August Crabbe',   position: 'D', preferred: 'Gus' },
  { id: 'goalie', number: null, name: 'Evan Crawford', position: 'G' }
];

const SCHEDULE = [
  { id: 'g2026-05-26', date: '2026-05-26', opponent: 'Green U11', time: '5:50 PM', venue: 'Indoor',  result: 'W 18–3', completed: true  },
  { id: 'g2026-05-28', date: '2026-05-28', opponent: 'Red U11',   time: '5:50 PM', venue: 'Outdoor', result: 'W 10–3', completed: true  },
  { id: 'g2026-06-04', date: '2026-06-04', opponent: 'White U11', time: '5:50 PM', venue: 'Outdoor', result: 'W 8–7', completed: true  },
  { id: 'g2026-06-07', date: '2026-06-07', opponent: 'Gray U11',  time: '4:10 PM', venue: 'Indoor',  result: null,     completed: false },
  { id: 'g2026-06-09', date: '2026-06-09', opponent: 'Green U11', time: '5:50 PM', venue: 'Indoor',  result: null,     completed: false },
  { id: 'g2026-06-11', date: '2026-06-11', opponent: 'Red U11',   time: '5:50 PM', venue: 'Outdoor', result: null,     completed: false },
  { id: 'g2026-06-14', date: '2026-06-14', opponent: 'White U11', time: '4:10 PM', venue: 'Indoor',  result: null,     completed: false },
  { id: 'g2026-06-18', date: '2026-06-18', opponent: 'Red U11',   time: '5:50 PM', venue: 'Indoor',  result: null,     completed: false },
  { id: 'g2026-06-23', date: '2026-06-23', opponent: 'White U11', time: '5:50 PM', venue: 'Outdoor', result: null,     completed: false },
  { id: 'g2026-06-25', date: '2026-06-25', opponent: 'Green U11', time: '5:50 PM', venue: 'Outdoor', result: null,     completed: false },
  { id: 'g2026-06-30', date: '2026-06-30', opponent: 'Gray U11',  time: '5:50 PM', venue: 'Outdoor', result: null,     completed: false },
  { id: 'g2026-07-05', date: '2026-07-05', opponent: 'Gray U11',  time: '4:10 PM', venue: 'Indoor',  result: null,     completed: false }
];

function firstName(player) {
  return player.preferred || player.name.split(' ')[0];
}

function getRoster() {
  try {
    const saved = localStorage.getItem('bp_roster');
    if (!saved) return DEFAULT_ROSTER;
    const roster = JSON.parse(saved);
    roster.forEach(p => {
      const def = DEFAULT_ROSTER.find(d => d.id === p.id);
      if (def && def.preferred && !p.preferred) p.preferred = def.preferred;
    });
    return roster;
  } catch (e) { return DEFAULT_ROSTER; }
}

function saveRosterLocal(roster) {
  try { localStorage.setItem('bp_roster', JSON.stringify(roster)); } catch (e) {}
}

function getPlayer(id) {
  return getRoster().find(p => p.id === id);
}

function getSkaters() {
  return getRoster().filter(p => p.position !== 'G');
}

function getGoalie() {
  return getRoster().find(p => p.position === 'G');
}

function renderRosterTab() {
  const roster = getRoster();
  const skaters = roster.filter(p => p.position !== 'G');
  const forwards = skaters.filter(p => p.position === 'F');
  const defence = skaters.filter(p => p.position === 'D');
  const goalie = roster.find(p => p.position === 'G');

  let html = `
    <div class="roster-section-header">Forwards (${forwards.length})</div>
    ${forwards.map(p => rosterPlayerCard(p)).join('')}
    <div class="roster-section-header">Defence (${defence.length})</div>
    ${defence.map(p => rosterPlayerCard(p)).join('')}
    <div class="roster-section-header">Goalie</div>
    ${goalie ? rosterPlayerCard(goalie) : ''}
    <div style="height:16px"></div>
    <div class="text-muted" style="text-align:center;font-size:13px">
      Stats: <a href="https://saintjohnballhockey.com/statistics/?seasonNo=5&teamNo=41" target="_blank" style="color:var(--navy)">saintjohnballhockey.com</a>
    </div>
  `;
  document.getElementById('roster-content').innerHTML = html;
}

function rosterPlayerCard(player) {
  return `
    <div class="roster-player-card">
      <div class="roster-player-number">${player.number !== null ? '#' + player.number : '—'}</div>
      <div class="roster-player-info">
        <div class="roster-player-name">${player.name}</div>
        <div class="roster-player-pos">${posLabel(player.position)}</div>
      </div>
      <div class="roster-pos-badge ${player.position}" onclick="togglePlayerPosition('${player.id}')">
        ${player.position}
      </div>
    </div>
  `;
}

function posLabel(pos) {
  if (pos === 'F') return 'Forward';
  if (pos === 'D') return 'Defence';
  if (pos === 'G') return 'Goalie';
  return pos;
}

function togglePlayerPosition(id) {
  if (id === 'goalie') return;
  const roster = getRoster();
  const player = roster.find(p => p.id === id);
  if (!player) return;
  player.position = player.position === 'F' ? 'D' : 'F';
  saveRosterLocal(roster);
  renderRosterTab();
}
