// Config
var TEAM_NAME = 'Yellow U11';

// Web endpoints

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === 'getAll') {
    var gamesSheet = ss.getSheetByName('Games');
    var games = sheetToObjects(gamesSheet).map(rowToGame);
    return jsonResponse({ games: games });
  }

  return jsonResponse({ status: 'ok' });
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (data.type === 'saveGame') {
    upsertGame(ss.getSheetByName('Games'), data.game);
  }

  if (data.type === 'saveLineChange') {
    var sheet = ss.getSheetByName('LineChanges');
    sheet.appendRow([data.gameId, new Date().toISOString(), JSON.stringify(data.lines), data.coach]);
  }

  if (data.type === 'saveReflection') {
    var gsheet = ss.getSheetByName('Games');
    updateGameColumns(gsheet, data.gameId, {
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

// Game sheet import

function parseGameSheet(gameNo) {
  var url = 'https://saintjohnballhockey.com/shark_modules/modules/GameReports/GameSheet.php'
          + '?site=1&lang=en&game_no=' + gameNo;
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      return { error: 'Game sheet not found for game #' + gameNo };
    }
    var blob = resp.getBlob().setName('bp_gs_' + gameNo + '.pdf');
    var text = pdfToText(blob);
    if (!text) return { error: 'Could not extract text from game sheet.' };
    var result = parseGameSheetText(text, gameNo);
    // Include raw lines for debugging when goals = 0
    if (!result.error && result.totalGoals === 0) {
      var allLines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
      result.debugLines = allLines.slice(0, 80);
    }
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

function pdfToText(blob) {
  // Upload PDF to Drive REST API to convert it to a Google Doc, then export as text.
  var token = ScriptApp.getOAuthToken();

  var boundary = 'bp_boundary_' + Date.now();
  var metadata = JSON.stringify({
    name: '_bp_gs_tmp_' + Date.now(),
    mimeType: 'application/vnd.google-apps.document'
  });
  var pdfBase64 = Utilities.base64Encode(blob.getBytes());

  var body = [
    '--' + boundary,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    '--' + boundary,
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    '',
    pdfBase64,
    '--' + boundary + '--'
  ].join('\r\n');

  var uploadResp = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      payload: body,
      muteHttpExceptions: true
    }
  );

  var fileId = JSON.parse(uploadResp.getContentText()).id;
  if (!fileId) return null;

  try {
    var textResp = UrlFetchApp.fetch(
      'https://docs.google.com/document/d/' + fileId + '/export?format=txt',
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    return textResp.getContentText();
  } finally {
    try {
      UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      });
    } catch(e) {}
  }
}

function parseGameSheetText(text, gameNo) {
  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

  var teamIdx = lines.findIndex(function(l) { return l.includes(TEAM_NAME); });
  if (teamIdx === -1) {
    return { error: TEAM_NAME + ' not found in game sheet. Wrong game number?' };
  }
  var teamLines = lines.slice(teamIdx + 1);

  var roster = [];
  var pastHeader = false;
  for (var i = 0; i < teamLines.length; i++) {
    var line = teamLines[i];
    if (/^#\s*Player/.test(line)) { pastHeader = true; continue; }
    if (!pastHeader) continue;
    if (/Support Staff|Team staff/i.test(line)) break;
    var m = line.match(/^(\d+)\s+([A-Za-z]+(?: [A-Za-z]+)+)/);
    if (m) roster.push({ number: parseInt(m[1]), name: m[2].trim() });
  }

  var scoring = [];
  var inScoring = false;
  for (var j = 0; j < teamLines.length; j++) {
    var tline = teamLines[j];
    if (/G\s+A\s+A\s+Time/.test(tline)) { inScoring = true; continue; }
    if (!inScoring) continue;
    if (/Suspension|Minor penalt|Major and|Goaltender/i.test(tline)) break;
    var goal = parseScoringLine(tline);
    if (goal) scoring.push(goal);
  }

  var map = {};
  function add(num, field) {
    if (!num) return;
    if (!map[num]) map[num] = { number: num, g: 0, a: 0, pts: 0 };
    map[num][field]++;
    map[num].pts++;
  }
  for (var k = 0; k < scoring.length; k++) {
    add(scoring[k].scorer, 'g');
    add(scoring[k].assist1, 'a');
    add(scoring[k].assist2, 'a');
  }

  return {
    gameNo: parseInt(gameNo),
    roster: roster,
    scoring: scoring,
    playerStats: Object.values(map),
    totalGoals: scoring.length
  };
}

function parseScoringLine(line) {
  var tokens = line.trim().split(/\s+/);
  var jerseys = [];
  var time = null, period = null;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (/^\d+:\d+$/.test(t))              time = t;
    else if (/^(P[123]|OT|SO)$/i.test(t)) period = t.toUpperCase();
    else if (/^\d+$/.test(t) && !time)    jerseys.push(parseInt(t));
  }
  if (!time || !period || jerseys.length === 0) return null;
  return { scorer: jerseys[0], assist1: jerseys[1] || null, assist2: jerseys[2] || null, time: time, period: period };
}

// Games sheet helpers

var GAME_HEADERS = [
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
  return headers.map(function(h) {
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
  var headers = ensureHeaders(sheet, GAME_HEADERS);
  var data = sheet.getDataRange().getValues();
  var idCol = headers.indexOf('GameID');
  var rowIdx = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(game.id)) { rowIdx = r + 1; break; }
  }
  var row = gameToRow(headers, game);
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function updateGameColumns(sheet, gameId, updates) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var data = sheet.getDataRange().getValues();
  var idCol = headers.indexOf('GameID');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) !== String(gameId)) continue;
    Object.entries(updates).forEach(function(entry) {
      var col = entry[0], val = entry[1];
      if (val === undefined) return;
      var c = headers.indexOf(col);
      if (c >= 0) sheet.getRange(r + 1, c + 1).setValue(val);
    });
    break;
  }
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) { sheet.appendRow(headers); return headers; }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var missing = headers.filter(function(h) { return !existing.includes(h); });
  if (missing.length > 0) {
    var startCol = existing.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    return existing.concat(missing);
  }
  return existing;
}

// Utilities

function sheetToObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = values.slice(1);
  return rows.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
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
