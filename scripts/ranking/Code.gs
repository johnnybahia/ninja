/**
 * Ranking do Kage - Google Apps Script (Web App) + Planilha Google.
 *
 * Instalação: veja scripts/ranking/README.md. Funciona como projeto avulso em script.google.com
 * (cria sozinho a planilha "Kage Ranking" no seu Drive na primeira chamada) ou colado numa
 * planilha existente (Extensões > Apps Script). Guarda uma linha por jogador:
 *   id | nome | pontos | onda | partidas | atualizado
 *
 * POST (corpo JSON enviado como text/plain, para não gerar preflight de CORS):
 *   { action: 'register', id, name }              reserva/troca o nome do jogador
 *   { action: 'score', id, name, score, wave }    registra uma pontuação (só vale se for a maior)
 * GET:
 *   ?action=top[&id=ID]   -> { ok, top: [{ n, s, w }], total, me?: { rank, n, s, w } }
 */

var SHEET_NAME = 'ranking';
var TOP_SIZE = 50;
var CACHE_SECONDS = 30;
var MIN_SECONDS_BETWEEN_POSTS = 4;
// teto plausível de pontos: cada onda rende bem menos que isso (abates + bônus de onda e chefe)
var MAX_SCORE_PER_WAVE = 4000;
var MAX_SCORE_BASE = 2000;
var MAX_WAVE = 99;
var BLOCKED_WORDS = ['puta', 'caralho', 'porra', 'merda', 'fdp', 'buceta', 'cuzao', 'viado', 'nazi', 'hitler'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if ((p.action || 'top') !== 'top') return out_({ ok: false, error: 'bad_action' });
  var res = { ok: true, top: topList_() };
  var rows = readRows_();
  res.total = rows.filter(function (r) { return r.score > 0; }).length;
  if (p.id && validId_(p.id)) {
    var ranked = rows.filter(function (r) { return r.score > 0; }).sort(byScore_);
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].id === p.id) {
        res.me = { rank: i + 1, n: ranked[i].name, s: ranked[i].score, w: ranked[i].wave };
        break;
      }
    }
  }
  return out_(res);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'bad_json' });
  }
  if (!body || !validId_(body.id)) return out_({ ok: false, error: 'bad_id' });

  var cache = CacheService.getScriptCache();
  var rlKey = 'rl_' + body.id;
  if (cache.get(rlKey)) return out_({ ok: false, error: 'slow_down' });
  cache.put(rlKey, '1', MIN_SECONDS_BETWEEN_POSTS);

  var name = cleanName_(body.name);
  if (!name) return out_({ ok: false, error: 'bad_name' });

  var sheet = sheet_(); // may create the spreadsheet (takes the script lock itself): before ours
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return out_({ ok: false, error: 'busy' });
  try {
    var rows = readRows_();
    var mine = null;
    var taken = false;
    var key = nameKey_(name);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === body.id) mine = rows[i];
      else if (nameKey_(rows[i].name) === key) taken = true;
    }
    if (taken) return out_({ ok: false, error: 'name_taken' });

    var score = 0;
    var wave = 0;
    if (body.action === 'score') {
      wave = Math.floor(Number(body.wave));
      score = Math.floor(Number(body.score));
      if (!(wave >= 1 && wave <= MAX_WAVE) || !(score >= 0) || score > wave * MAX_SCORE_PER_WAVE + MAX_SCORE_BASE) {
        return out_({ ok: false, error: 'bad_score' });
      }
    } else if (body.action !== 'register') {
      return out_({ ok: false, error: 'bad_action' });
    }

    var now = new Date();
    if (!mine) {
      sheet.appendRow([body.id, name, score, wave, body.action === 'score' ? 1 : 0, now]);
    } else {
      var better = body.action === 'score' && score > mine.score;
      sheet.getRange(mine.row, 2).setValue(name);
      if (better) {
        sheet.getRange(mine.row, 3).setValue(score);
        sheet.getRange(mine.row, 4).setValue(wave);
      }
      if (body.action === 'score') sheet.getRange(mine.row, 5).setValue(mine.runs + 1);
      sheet.getRange(mine.row, 6).setValue(now);
    }
    cache.remove('top');
    return out_({ ok: true, name: name });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// A planilha: a que contém o script (se ele estiver dentro de uma) ou a que ele mesmo criou
function spreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (!id) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      id = props.getProperty('SHEET_ID');
      if (!id) {
        id = SpreadsheetApp.create('Kage Ranking').getId();
        props.setProperty('SHEET_ID', id);
      }
    } finally {
      lock.releaseLock();
    }
  }
  return SpreadsheetApp.openById(id);
}

// Opcional: rode uma vez no editor para criar a planilha e ver o endereço dela no registro
function setup() {
  sheet_();
  Logger.log(spreadsheet_().getUrl());
}

function sheet_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['id', 'nome', 'pontos', 'onda', 'partidas', 'atualizado']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 6).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    rows.push({
      row: i + 2,
      id: String(vals[i][0]),
      name: String(vals[i][1]),
      score: Number(vals[i][2]) || 0,
      wave: Number(vals[i][3]) || 0,
      runs: Number(vals[i][4]) || 0
    });
  }
  return rows;
}

function byScore_(a, b) {
  return b.score - a.score || b.wave - a.wave;
}

function topList_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('top');
  if (hit) return JSON.parse(hit);
  var top = readRows_()
    .filter(function (r) { return r.score > 0; })
    .sort(byScore_)
    .slice(0, TOP_SIZE)
    .map(function (r) { return { n: r.name, s: r.score, w: r.wave }; });
  cache.put('top', JSON.stringify(top), CACHE_SECONDS);
  return top;
}

function validId_(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{16,40}$/.test(id);
}

// 2 a 16 caracteres: letras, números, espaço, ponto, hífen e sublinhado
function cleanName_(raw) {
  var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 16) return '';
  if (!/^[\p{L}\p{N} ._-]+$/u.test(s)) return '';
  var k = nameKey_(s).replace(/[ ._-]/g, '');
  for (var i = 0; i < BLOCKED_WORDS.length; i++) if (k.indexOf(BLOCKED_WORDS[i]) !== -1) return '';
  return s;
}

// compara nomes sem acento, sem maiúsculas e sem pontuação (Léo = leo = L.e.o)
function nameKey_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[ ._-]/g, '');
}
