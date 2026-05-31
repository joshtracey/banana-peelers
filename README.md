# Banana Peelers Line Manager

Mobile-first web app for managing ball hockey lines collaboratively.

**Live app:** https://joshtracey.github.io/banana-peelers

---

## Apps Script Code

Paste this into your Google Apps Script (Extensions → Apps Script), replacing all existing code, then re-deploy as a web app (Execute as: Me, Anyone can access).

```javascript
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = e && e.parameter && e.parameter.action;

  if (action === 'getAll') {
    const gamesSheet = ss.getSheetByName('Games');
    const changesSheet = ss.getSheetByName('LineChanges');

    const games = sheetToObjects(gamesSheet).map(row => {
      const g = {
        id: row.GameID,
        date: row.Date,
        opponent: row.Opponent,
        time: row.Time,
        venue: row.Venue,
        result: row.Result,
        completed: row.Completed === 'TRUE' || row.Completed === true,
        isActive: row.IsActive === 'TRUE' || row.IsActive === true,
        isRetroactive: row.IsRetroactive === 'TRUE' || row.IsRetroactive === true,
        goaliePresent: row.GoaliePresent !== 'FALSE' && row.GoaliePresent !== false,
        goalieFillIn: row.GoalieFillIn || null,
        attendance: row.Attendance ? row.Attendance.split(',').filter(Boolean) : [],
        lines: safeJson(row.Lines, []),
        finalLines: safeJson(row.FinalLines, []),
        reflectionCoach1: row.ReflectionCoach1 || '',
        reflectionCoach2: row.ReflectionCoach2 || '',
        lineNotesCoach1: row.LineNotesCoach1 || '',
        lineNotesCoach2: row.LineNotesCoach2 || '',
        statsUrl: row.StatsURL || ''
      };
      return g;
    });

    return jsonResponse({ games });
  }

  return jsonResponse({ status: 'ok' });
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(e.postData.contents);

  if (data.type === 'saveGame') {
    const sheet = ss.getSheetByName('Games');
    const game = data.game;
    upsertGame(sheet, game);
  }

  if (data.type === 'saveLineChange') {
    const sheet = ss.getSheetByName('LineChanges');
    sheet.appendRow([
      data.gameId,
      new Date().toISOString(),
      JSON.stringify(data.lines),
      data.coach
    ]);
  }

  if (data.type === 'saveReflection') {
    const sheet = ss.getSheetByName('Games');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const data2 = sheet.getDataRange().getValues();
    const idCol = headers.indexOf('GameID');
    for (let r = 1; r < data2.length; r++) {
      if (data2[r][idCol] === data.gameId) {
        const coachCol = data.coach === 'Coach1'
          ? headers.indexOf('ReflectionCoach1')
          : headers.indexOf('ReflectionCoach2');
        const notesCol = data.coach === 'Coach1'
          ? headers.indexOf('LineNotesCoach1')
          : headers.indexOf('LineNotesCoach2');
        const statsCol = headers.indexOf('StatsURL');
        if (coachCol >= 0) sheet.getRange(r + 1, coachCol + 1).setValue(data.reflection || '');
        if (notesCol >= 0) sheet.getRange(r + 1, notesCol + 1).setValue(data.lineNotes || '');
        if (statsCol >= 0 && data.statsUrl) sheet.getRange(r + 1, statsCol + 1).setValue(data.statsUrl);
        break;
      }
    }
  }

  return jsonResponse({ status: 'ok' });
}

function upsertGame(sheet, game) {
  const headers = getOrCreateHeaders(sheet, [
    'GameID','Date','Opponent','Time','Venue','Result','Completed',
    'IsActive','IsRetroactive','GoaliePresent','GoalieFillIn',
    'Attendance','Lines','FinalLines',
    'ReflectionCoach1','ReflectionCoach2',
    'LineNotesCoach1','LineNotesCoach2','StatsURL'
  ]);
  const data = sheet.getDataRange().getValues();
  const idCol = headers.indexOf('GameID');
  let rowIdx = -1;
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === game.id) { rowIdx = r + 1; break; }
  }
  const row = headers.map(h => {
    switch(h) {
      case 'GameID': return game.id;
      case 'Date': return game.date;
      case 'Opponent': return game.opponent || '';
      case 'Time': return game.time || '';
      case 'Venue': return game.venue || '';
      case 'Result': return game.result || '';
      case 'Completed': return game.completed ? 'TRUE' : 'FALSE';
      case 'IsActive': return game.isActive ? 'TRUE' : 'FALSE';
      case 'IsRetroactive': return game.isRetroactive ? 'TRUE' : 'FALSE';
      case 'GoaliePresent': return game.goaliePresent !== false ? 'TRUE' : 'FALSE';
      case 'GoalieFillIn': return game.goalieFillIn || '';
      case 'Attendance': return (game.attendance || []).join(',');
      case 'Lines': return JSON.stringify(game.lines || []);
      case 'FinalLines': return JSON.stringify(game.finalLines || []);
      case 'ReflectionCoach1': return game.reflectionCoach1 || '';
      case 'ReflectionCoach2': return game.reflectionCoach2 || '';
      case 'LineNotesCoach1': return game.lineNotesCoach1 || '';
      case 'LineNotesCoach2': return game.lineNotesCoach2 || '';
      case 'StatsURL': return game.statsUrl || '';
      default: return '';
    }
  });
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function getOrCreateHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return headers;
  }
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

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

## Google Sheet Setup

Create a sheet called `Banana Peelers` with three tabs:

**Games** tab headers (Row 1):
`GameID | Date | Opponent | Time | Venue | Result | Completed | IsActive | IsRetroactive | GoaliePresent | GoalieFillIn | Attendance | Lines | FinalLines | ReflectionCoach1 | ReflectionCoach2 | LineNotesCoach1 | LineNotesCoach2 | StatsURL`

**LineChanges** tab headers (Row 1):
`GameID | Timestamp | Lines | ChangedBy`

The **Roster** tab is managed in the app — no sheet setup needed.

---

## Stats Links

- Team: https://saintjohnballhockey.com/teams/?seasonNo=5&teamNo=41
- Stats: https://saintjohnballhockey.com/statistics/?seasonNo=5&teamNo=41
- Results: https://saintjohnballhockey.com/results/?seasonNo=5&teamNo=41
- Schedule: https://saintjohnballhockey.com/schedule/?seasonNo=5&teamNo=41
