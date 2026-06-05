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
    if (!text || text.trim().length === 0) {
      return { error: 'Could not extract text from game sheet.' };
    }
    return parseGameSheetText(text, gameNo);
  } catch (err) {
    return { error: err.message };
  }
}

function pdfToText(blob) {
  // Use Drive API resumable upload to convert PDF -> Google Doc, then export as plain text.
  // Resumable upload sends raw bytes (no base64 encoding) which is more reliable.
  // DriveApp call ensures the drive scope is granted when the script is authorized.
  DriveApp.getRootFolder();
  var token = ScriptApp.getOAuthToken();
  var pdfBytes = blob.getBytes();

  // Step 1: Initiate the resumable upload session
  var initResp = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/pdf',
        'X-Upload-Content-Length': String(pdfBytes.length)
      },
      payload: JSON.stringify({
        name: '_bp_gs_tmp_' + Date.now(),
        mimeType: 'application/vnd.google-apps.document'
      }),
      muteHttpExceptions: true
    }
  );

  if (initResp.getResponseCode() !== 200) return null;
  var uploadUrl = initResp.getHeaders()['Location'] || initResp.getHeaders()['location'];
  if (!uploadUrl) return null;

  // Step 2: Upload the raw PDF bytes
  var uploadResp = UrlFetchApp.fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    payload: pdfBytes,
    muteHttpExceptions: true
  });

  if (uploadResp.getResponseCode() !== 200) return null;
  var fileId = JSON.parse(uploadResp.getContentText()).id;
  if (!fileId) return null;

  // Give Drive a moment to finish the PDF->Doc conversion
  Utilities.sleep(3000);

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
  var allLines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

  // Find both "G A A Time Per." scoring section headers
  var scoringHeaders = [];
  for (var i = 0; i < allLines.length; i++) {
    if (/G\s+A\s+A\s+Time/i.test(allLines[i])) scoringHeaders.push(i);
  }
  if (scoringHeaders.length === 0) {
    return { error: 'No scoring section found in game sheet.', roster: [], scoring: [], playerStats: [], totalGoals: 0 };
  }

  // Determine if our team is first or second in the document
  var ourFirstLine = -1, otherFirstLine = -1;
  for (var ti = 0; ti < allLines.length; ti++) {
    if (ourFirstLine === -1 && allLines[ti].indexOf(TEAM_NAME) !== -1) ourFirstLine = ti;
    if (otherFirstLine === -1 && /[A-Za-z]+\s+U\d+/i.test(allLines[ti]) && allLines[ti].indexOf(TEAM_NAME) === -1) otherFirstLine = ti;
  }
  var weAreSecond = otherFirstLine !== -1 && otherFirstLine < ourFirstLine;
  var ourHeaderIdx  = (weAreSecond && scoringHeaders.length >= 2) ? scoringHeaders[1] : scoringHeaders[0];
  var theirHeaderIdx = (weAreSecond && scoringHeaders.length >= 2) ? scoringHeaders[0] : (scoringHeaders[1] !== undefined ? scoringHeaders[1] : -1);

  // Build a map of jersey → first name words seen in our roster section.
  // Used in pass 2 of parseScoringFromLine to skip roster entries masquerading as scorers.
  // e.g. rosterCtx[21] = { AUGUST: true } so "21 AUGUST … time period" won't produce scorer=21.
  var rosterCtx = {};
  var sectionStart = ourFirstLine >= 0 ? ourFirstLine : 0;
  for (var ri = sectionStart; ri < ourHeaderIdx; ri++) {
    var rtoks = allLines[ri].split(/\s+/);
    for (var rj = 0; rj < rtoks.length - 1; rj++) {
      if (/^\d+$/.test(rtoks[rj]) && /^[A-Za-z]+$/.test(rtoks[rj + 1])) {
        var rnum = parseInt(rtoks[rj]);
        if (!rosterCtx[rnum]) rosterCtx[rnum] = {};
        rosterCtx[rnum][rtoks[rj + 1].toUpperCase()] = true;
      }
    }
  }

  // Collect our scoring entries. Mixed-case full-name lines (shootout participant lists)
  // are used only for fill-in player name resolution via shootoutNameMap — they do not
  // change the parsing mode. All lines with time tokens use parseScoringFromLine.
  // Opponent goals that bleed into our section due to PDF two-column layout are removed
  // afterward using time+period matching against the opponent's scoring section.
  var scoring = [];
  var shootoutNameMap = {};
  var snRe = /\b(\d+)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/g;
  for (var j = ourHeaderIdx; j < allLines.length; j++) {
    var sline = allLines[j];
    var stopIdx = sline.search(/Franc jeu|Goaltender|Shootout/i);
    var stop = stopIdx >= 0;
    if (stop) sline = sline.slice(0, stopIdx);
    sline = sline.replace(/G\s+A\s+A\s+Time\s+Per\./i, '').replace(/#\s*Code\s+Time\s+Per\./i, '').trim();
    if (sline) {
      var hasTime = /\d+:\d+/.test(sline);
      var hasMixedCaseName = /\d+\s+[A-Z][a-z]+\s+[A-Z][a-z]/.test(sline);
      if (!hasTime && hasMixedCaseName) {
        snRe.lastIndex = 0;
        var snm;
        while ((snm = snRe.exec(sline)) !== null) {
          var snNum = parseInt(snm[1]);
          var snName = snm[2].trim();
          var snFirst = snName.split(' ')[0].toUpperCase();
          if (rosterCtx[snNum] && rosterCtx[snNum][snFirst]) {
            shootoutNameMap[snNum] = snName;
          } else if (!rosterCtx[snNum]) {
            if (weAreSecond || !shootoutNameMap.hasOwnProperty(snNum)) {
              shootoutNameMap[snNum] = snName;
            }
          }
        }
      }
      if (hasTime) {
        scoring = scoring.concat(parseScoringFromLine(sline, rosterCtx));
      }
    }
    if (stop) break;
  }

  // Collect opponent scoring entries: numbers for ourNumbers disambiguation, and
  // time+period keys to strip opponent goals that bled into our scoring section.
  var theirGoalTimes = {};
  var theirNumbers = {};
  if (theirHeaderIdx >= 0) {
    for (var tj = theirHeaderIdx; tj < allLines.length; tj++) {
      var tline = allLines[tj];
      if (/Franc jeu|Goaltender|Shootout/i.test(tline)) break;
      tline = tline.replace(/G\s+A\s+A\s+Time\s+Per\./i, '').trim();
      parseScoringFromLine(tline).forEach(function(g) {
        if (g.scorer)  theirNumbers[g.scorer]  = true;
        if (g.assist1) theirNumbers[g.assist1] = true;
        if (g.assist2) theirNumbers[g.assist2] = true;
        if (g.time && g.period) theirGoalTimes[g.time + ':' + g.period] = true;
      });
    }
  }

  // Remove opponent goals that appeared in our section due to PDF column interleaving
  scoring = scoring.filter(function(g) {
    return !theirGoalTimes[g.time + ':' + g.period];
  });

  // Numbers that appeared in our scoring
  var ourNumbers = {};
  scoring.forEach(function(g) {
    if (g.scorer)  ourNumbers[g.scorer]  = true;
    if (g.assist1) ourNumbers[g.assist1] = true;
    if (g.assist2) ourNumbers[g.assist2] = true;
  });

  // Extract player-roster lines only from our team's section of the document
  // (between where our team name appears and where our scoring section begins).
  // This avoids picking up opponent players. Patterns are case-insensitive to
  // handle all-caps names common on formal game sheets.
  var playerLineRe = /\b\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)+/;
  var extractRe = /\b(\d+)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/g;
  var rosterEntries = [];
  var seenOnRosterLine = {};
  for (var li = sectionStart; li < ourHeaderIdx; li++) {
    if (!playerLineRe.test(allLines[li])) continue;
    var m;
    extractRe.lastIndex = 0;
    while ((m = extractRe.exec(allLines[li])) !== null) {
      rosterEntries.push({ number: parseInt(m[1]), name: m[2].trim() });
      seenOnRosterLine[parseInt(m[1])] = true;
    }
  }

  // Scoring participants not found on any roster line: use shootout participant name if available
  Object.keys(ourNumbers).forEach(function(n) {
    var num = parseInt(n);
    if (!seenOnRosterLine[num]) rosterEntries.push({ number: num, name: shootoutNameMap[num] || null });
  });

  // Detect goalie via "Name (#number)" pattern (one entry per team in the document)
  var goalieRe = /([A-Za-z]+(?:\s+[A-Za-z]+)+)\s*\(#(\d+)\)/g;
  var goalieMatches = [];
  var fullText = allLines.join('\n');
  var gm;
  while ((gm = goalieRe.exec(fullText)) !== null) {
    goalieMatches.push({ name: gm[1], number: parseInt(gm[2]) });
  }
  var goalieEntry = goalieMatches.length > 0 ? (goalieMatches[weAreSecond ? 1 : 0] || goalieMatches[0]) : null;
  if (goalieEntry) {
    rosterEntries.push({ number: goalieEntry.number, name: goalieEntry.name, isGoalie: true });
  }

  var roster = rosterEntries;

  // Tally stats
  var map = {};
  function add(num, field) {
    if (!num) return;
    if (!map[num]) {
      var re = rosterEntries.find(function(r) { return r.number === num; });
      map[num] = { number: num, name: re ? re.name : null, g: 0, a: 0, pts: 0 };
    }
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

function parseScoringFromLine(line, rosterCtx) {
  // For each TIME PERIOD anchor, find scorer/assist jerseys via two backward passes:
  //
  // Pass 1 (contiguous): collect numbers immediately before the time, stop at the
  //   first non-number. Handles "21 AUGUST CRABBE 22 01:23 P1" correctly — finds 22,
  //   stops at CRABBE, so roster jersey 21 is never included.
  //
  // Pass 2 (skip-names fallback): only when pass 1 finds nothing. Skips over name
  //   tokens to find the scorer that sits before them. Uses rosterCtx (a map of
  //   jersey → set of first-name words seen in our roster section) to skip past
  //   roster entries: if jersey X is immediately followed (forward) by a word in
  //   rosterCtx[X], X is a roster entry and not a scorer.
  var goals = [];
  var tokens = line.trim().split(/\s+/);

  for (var i = 0; i < tokens.length - 1; i++) {
    if (/^\d+:\d+$/.test(tokens[i]) && /^(P[123]|OT|SO)$/i.test(tokens[i + 1])) {
      // Skip penalty entries (e.g. "A44") and shootout saves ("Safe") immediately before the time
      if (i > 0 && (/^[A-Za-z]+\d+$/.test(tokens[i - 1]) || /^safe$/i.test(tokens[i - 1]))) continue;
      // Pass 1: contiguous numbers immediately before the time
      var jerseys = [];
      for (var j = i - 1; j >= 0; j--) {
        if (/^\d+$/.test(tokens[j])) {
          jerseys.unshift(parseInt(tokens[j]));
        } else {
          break;
        }
      }

      // Pass 2: skip name tokens, but reject roster-entry jerseys
      if (jerseys.length === 0) {
        var k = i - 1;
        while (k >= 0) {
          if (/^\d+$/.test(tokens[k])) {
            var num = parseInt(tokens[k]);
            var nextWord = tokens[k + 1] ? tokens[k + 1].toUpperCase() : null;
            var isRosterEntry = rosterCtx && nextWord &&
                                rosterCtx[num] && rosterCtx[num][nextWord];
            if (isRosterEntry) {
              k--; // this jersey is immediately followed by its player's name — skip it
            } else {
              while (k >= 0 && /^\d+$/.test(tokens[k])) {
                jerseys.unshift(parseInt(tokens[k--]));
              }
              break;
            }
          } else if (/^\d+:\d+$/.test(tokens[k])) {
            break; // hit a previous goal's time — stop
          } else {
            k--; // skip name token from other column
          }
        }
      }

      if (jerseys.length > 0) {
        goals.push({
          scorer:  jerseys[0],
          assist1: jerseys[1] || null,
          assist2: jerseys[2] || null,
          time:    tokens[i],
          period:  tokens[i + 1].toUpperCase()
        });
      }
    }
  }
  return goals;
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
