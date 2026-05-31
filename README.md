# Banana Peelers Line Manager

Mobile-first web app for managing ball hockey lines collaboratively.

**Live app:** https://joshtracey.github.io/banana-peelers

---

## Apps Script Setup

### One-time: enable Drive API
In the Apps Script editor, click **Services** (the + icon in the left sidebar) → search **Drive API** → Add. This lets the script convert PDFs to text for game sheet import.

### Full script — paste this, replacing all existing code, then re-deploy

Re-deploy: **Deploy → Manage deployments → edit (pencil) → New version → Deploy**

```javascript
// ── Config ──
const TEAM_NAME = 'Yellow U11';

// ── Web endpoints ──

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === 'getAll') {
    const gamesSheet = ss.getSheetByName('Games');
    const games = sheetToObjects(gamesSheet).map(rowToGame);
    return jsonResponse({ games });
  }

  return jsonResponse({ status: 'ok' });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (data.type === 'saveGame') {
    upsertGame(ss.getSheetByName('Games'), data.game);
  }

  if (data.type === 'saveLineChange') {
    const sheet = ss.getSheetByName('LineChanges');
    sheet.appendRow([data.gameId, new Date().toISOString(), JSON.stringify(data.lines), data.coach]);
  }

  if (data.type === 'saveReflection') {
    const sheet = ss.getSheetByName('Games');
    updateGameColumns(sheet, data.gameId, {
      ReflectionCoach1: data.coach === 'Coach1' ? data.reflection : undefined,
      ReflectionCoach2: data.coach === 'Coach2' ? data.reflection : undefined,
      LineNotesCoach1:  data.coach === 'Coach1' ? data.lineNotes  : undefined,
      LineNotesCoach2:  data.coach === 'Coach2' ? data.lineNotes  : undefined,
      StatsURL: data.statsUrl || undefined
    });
  }

  if (data.type === 'parseGameSheet') {
    return jsonResponse(parseGameSheet(data.gameNo));
  }

  return jsonResponse({ status: 'ok' });
}

// ── Game sheet import ──

function parseGameSheet(gameNo) {
  const url = 'https://saintjohnballhockey.com/shark_modules/modules/GameReports/GameSheet.php'
            + '?site=1&lang=en&game_no=' + gameNo;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      return { error: 'Game sheet not found for game #' + gameNo };
    }
    const blob = resp.getBlob().setName('bp_gs_' + gameNo + '.pdf');
    const text = pdfToText(blob);
    if (!text) return { error: 'Could not extract text from game sheet.' };
    return parseGameSheetText(text, gameNo);
  } catch (err) {
    return { error: err.message };
  }
}

function pdfToText(blob) {
  // Upload PDF to Drive as a Google Doc (converts automatically), extract text, delete.
  const file = Drive.Files.create(
    { name: '_bp_temp_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
    blob
  );
  try {
    const doc = DocumentApp.openById(file.id);
    return doc.getBody().getText();
  } finally {
    try { DriveApp.getFileById(file.id).setTrashed(true); } catch(e) {}
  }
}

function parseGameSheetText(text, gameNo) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Find our team section
  const teamIdx = lines.findIndex(l => l.includes(TEAM_NAME));
  if (teamIdx === -1) {
    return { error: TEAM_NAME + ' not found in game sheet. Wrong game number?' };
  }
  const teamLines = lines.slice(teamIdx + 1);

  // Extract roster (players listed before "Support Staff")
  const roster = [];
  let pastHeader = false;
  for (const line of teamLines) {
    if (/^#\s*Player/.test(line)) { pastHeader = true; continue; }
    if (!pastHeader) continue;
    if (/Support Staff|Team staff/i.test(line)) break;
    const m = line.match(/^(\d+)\s+([A-Za-z]+(?: [A-Za-z]+)+)/);
    if (m) roster.push({ number: parseInt(m[1]), name: m[2].trim() });
  }

  // Extract scoring (between "G A A Time Per." and "Suspensions")
  const scoring = [];
  let inScoring = false;
  for (const line of teamLines) {
    if (/G\s+A\s+A\s+Time/.test(line)) { inScoring = true; continue; }
    if (!inScoring) continue;
    if (/Suspension|Minor penalt|Major and|Goaltender/i.test(line)) break;
    const goal = parseScoringLine(line);
    if (goal) scoring.push(goal);
  }

  // Tally stats per jersey number
  const map = {};
  const add = (num, field) => {
    if (!num) return;
    if (!map[num]) map[num] = { number: num, g: 0, a: 0, pts: 0 };
    map[num][field]++;
    map[num].pts++;
  };
  for (const goal of scoring) {
    add(goal.scorer, 'g');
    add(goal.assist1, 'a');
    add(goal.assist2, 'a');
  }

  return {
    gameNo: parseInt(gameNo),
    roster,
    scoring,
    playerStats: Object.values(map),
    totalGoals: scoring.length
  };
}

function parseScoringLine(line) {
  const tokens = line.trim().split(/\s+/);
  const jerseys = [];
  let time = null, period = null;
  for (const t of tokens) {
    if (/^\d+:\d+$/.test(t))             time = t;
    else if (/^(P[123]|OT|SO)$/i.test(t)) period = t.toUpperCase();
    else if (/^\d+$/.test(t) && !time)    jerseys.push(parseInt(t));
  }
  if (!time || !period || jerseys.length === 0) return null;
  return { scorer: jerseys[0], assist1: jerseys[1] || null, assist2: jerseys[2] || null, time, period };
}

// ── Games sheet helpers ──

const GAME_HEADERS = [
  'GameID','Date','Opponent','Time','Venue','Result','Completed',
  'IsActive','IsRetroactive','GoaliePresent','GoalieFillIn',
  'Attendance','Lines','FinalLines',
  'ReflectionCoach1','ReflectionCoach2',
  'LineNotesCoach1','LineNotesCoach2','StatsURL',
  'GameNo','PlayerStats','Scoring'
];

function rowToGame(row) {
  return {
    id:               row.GameID,
    date:             row.Date,
    opponent:         row.Opponent || '',
    time:             row.Time || '',
    venue:            row.Venue || '',
    result:           row.Result || null,
    completed:        row.Completed === 'TRUE',
    isActive:         row.IsActive === 'TRUE',
    isRetroactive:    row.IsRetroactive === 'TRUE',
    goaliePresent:    row.GoaliePresent !== 'FALSE',
    goalieFillIn:     row.GoalieFillIn || null,
    attendance:       row.Attendance ? row.Attendance.split(',').filter(Boolean) : [],
    lines:            safeJson(row.Lines, []),
    finalLines:       safeJson(row.FinalLines, []),
    reflectionCoach1: row.ReflectionCoach1 || '',
    reflectionCoach2: row.ReflectionCoach2 || '',
    lineNotesCoach1:  row.LineNotesCoach1 || '',
    lineNotesCoach2:  row.LineNotesCoach2 || '',
    statsUrl:         row.StatsURL || '',
    gameNo:           row.GameNo ? parseInt(row.GameNo) : null,
    playerStats:      safeJson(row.PlayerStats, []),
    scoring:          safeJson(row.Scoring, [])
  };
}

function gameToRow(headers, game) {
  return headers.map(h => {
    switch(h) {
      case 'GameID':          return game.id;
      case 'Date':            return game.date;
      case 'Opponent':        return game.opponent || '';
      case 'Time':            return game.time || '';
      case 'Venue':           return game.venue || '';
      case 'Result':          return game.result || '';
      case 'Completed':       return game.completed ? 'TRUE' : 'FALSE';
      case 'IsActive':        return game.isActive ? 'TRUE' : 'FALSE';
      case 'IsRetroactive':   return game.isRetroactive ? 'TRUE' : 'FALSE';
      case 'GoaliePresent':   return game.goaliePresent !== false ? 'TRUE' : 'FALSE';
      case 'GoalieFillIn':    return game.goalieFillIn || '';
      case 'Attendance':      return (game.attendance || []).join(',');
      case 'Lines':           return JSON.stringify(game.lines || []);
      case 'FinalLines':      return JSON.stringify(game.finalLines || []);
      case 'ReflectionCoach1':return game.reflectionCoach1 || '';
      case 'ReflectionCoach2':return game.reflectionCoach2 || '';
      case 'LineNotesCoach1': return game.lineNotesCoach1 || '';
      case 'LineNotesCoach2': return game.lineNotesCoach2 || '';
      case 'StatsURL':        return game.statsUrl || '';
      case 'GameNo':          return game.gameNo || '';
      case 'PlayerStats':     return JSON.stringify(game.playerStats || []);
      case 'Scoring':         return JSON.stringify(game.scoring || []);
      default:                return '';
    }
  });
}

function upsertGame(sheet, game) {
  const headers = ensureHeaders(sheet, GAME_HEADERS);
  const data = sheet.getDataRange().getValues();
  const idCol = headers.indexOf('GameID');
  let rowIdx = -1;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(game.id)) { rowIdx = r + 1; break; }
  }
  const row = gameToRow(headers, game);
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function updateGameColumns(sheet, gameId, updates) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getDataRange().getValues();
  const idCol = headers.indexOf('GameID');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) !== String(gameId)) continue;
    Object.entries(updates).forEach(([col, val]) => {
      if (val === undefined) return;
      const c = headers.indexOf(col);
      if (c >= 0) sheet.getRange(r + 1, c + 1).setValue(val);
    });
    break;
  }
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) { sheet.appendRow(headers); return headers; }
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  // Add any missing columns to the right
  const missing = headers.filter(h => !existing.includes(h));
  if (missing.length > 0) {
    const startCol = existing.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    return [...existing, ...missing];
  }
  return existing;
}

// ── Utilities ──

function sheetToObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch(e) { return fallback; }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## Google Sheet tab headers

**Games** (Row 1):
`GameID | Date | Opponent | Time | Venue | Result | Completed | IsActive | IsRetroactive | GoaliePresent | GoalieFillIn | Attendance | Lines | FinalLines | ReflectionCoach1 | ReflectionCoach2 | LineNotesCoach1 | LineNotesCoach2 | StatsURL | GameNo | PlayerStats | Scoring`

**LineChanges** (Row 1):
`GameID | Timestamp | Lines | ChangedBy`

---

## Finding a game number

Go to `saintjohnballhockey.com/results/?seasonNo=5&teamNo=41`, hover a game result — the URL preview shows `game_no=NNN`. That number goes in the Import field.

Known game numbers:
| Date | Opponent | Game # |
|------|----------|--------|
| May 26 | Green U11 | 623 |
| May 28 | Red U11 | ? |

---

## Stats links

- Results: https://saintjohnballhockey.com/results/?seasonNo=5&teamNo=41
- Stats: https://saintjohnballhockey.com/statistics/?seasonNo=5&teamNo=41
