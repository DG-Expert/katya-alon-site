/**
 * Registration backend (Google Apps Script, V8). Called ONLY server-to-server by the Cloudflare Worker.
 * Every request must carry a valid HMAC envelope; the browser never talks to this script.
 *
 * Script Properties (Project Settings): SHEET_ID, HMAC_SECRET, DEDUPE_SALT, OWNER_EMAIL,
 * optional EVENT_START_ISO / EVENT_END_ISO (local, e.g. 2026-11-16T18:00:00) and EVENT_TIMEZONE (e.g. Asia/Jerusalem).
 */

var SHEET_NAME = 'Registrations';
var COLUMNS = ['registeredAt', 'registrationId', 'workshopId', 'full_name', 'mobile', 'email', 'expertise', 'lang', 'consentVersion',
  'status', 'requestId', 'fingerprint', 'emailHash', 'mobileHash', 'ownerMail', 'registrantMail', 'mailAttempts', 'mailUpdatedAt'];
var MAX_SKEW_SECONDS = 300;
var MAX_MAIL_ATTEMPTS = 5;
var SENDING_STALE_MS = 10 * 60 * 1000;
var RETRY_BATCH = 20;
var PAYLOAD_KEYS = ['workshopId', 'full_name', 'mobile', 'email', 'expertise', 'lang', 'consentVersion'];

// ---------- web entry ----------

function doPost(e) {
  var out;
  try {
    out = handle_(e);
  } catch (err) {
    console.error('doPost failed: ' + (err && err.name)); // never log payloads
    out = { status: 'unavailable' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'invalid' })).setMimeType(ContentService.MimeType.JSON);
}

function handle_(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('HMAC_SECRET');
  if (!secret || !props.getProperty('SHEET_ID') || !props.getProperty('DEDUPE_SALT')) return { status: 'unavailable' };

  var env;
  try { env = JSON.parse(e && e.postData && e.postData.contents); } catch (x) { return { status: 'auth' }; }
  if (!env || env.v !== 1 || typeof env.ts !== 'number' || typeof env.rid !== 'string' || typeof env.payload !== 'string' || typeof env.sig !== 'string') return { status: 'auth' };
  var expected = hmacHex_(secret, env.v + '.' + env.ts + '.' + env.rid + '.' + env.payload);
  if (!constantTimeEqual_(expected, env.sig)) return { status: 'auth' };
  if (Math.abs(Math.floor(Date.now() / 1000) - env.ts) > MAX_SKEW_SECONDS) return { status: 'auth' };

  var data = parsePayload_(env.payload);
  if (!data || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(env.rid)) return { status: 'invalid' };

  var salt = props.getProperty('DEDUPE_SALT');
  var fingerprint = sha256Hex_(salt + ':fp:' + env.payload);
  var emailHash = sha256Hex_(salt + ':email:' + data.workshopId + ':' + data.email.toLowerCase());
  var mobileHash = sha256Hex_(salt + ':mobile:' + data.workshopId + ':' + data.mobile);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var registrationId, replay = false;
  try {
    var sheet = getSheet_();
    var rows = readRows_(sheet);
    // ponytail: linear scan, fine for hundreds of rows; add an index sheet if it ever grows past a few thousand.
    var existing = null, dup = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].requestId === env.rid) existing = rows[i];
      else if (rows[i].workshopId === data.workshopId && (rows[i].emailHash === emailHash || rows[i].mobileHash === mobileHash)) dup = true;
    }
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { status: 'conflict' };
      registrationId = existing.registrationId;
      replay = true;
    } else if (dup) {
      return { status: 'duplicate' };
    } else {
      registrationId = 'R-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
      var record = {
        registeredAt: new Date().toISOString(), registrationId: registrationId, workshopId: data.workshopId,
        full_name: cell_(data.full_name), mobile: cell_(data.mobile), email: cell_(data.email), expertise: cell_(data.expertise),
        lang: data.lang, consentVersion: cell_(data.consentVersion), status: 'RECEIVED', requestId: env.rid, fingerprint: fingerprint,
        emailHash: emailHash, mobileHash: mobileHash, ownerMail: 'PENDING', registrantMail: 'PENDING', mailAttempts: 0, mailUpdatedAt: ''
      };
      var r = sheet.getLastRow() + 1;
      if (r > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100); // default grid is 1000 rows; getRange throws past it
      sheet.getRange(r, 1, 1, COLUMNS.length).setValues([COLUMNS.map(function (c) { return record[c]; })]);
    }
  } finally {
    lock.releaseLock();
  }

  if (!replay) {
    try { dispatchMails_(registrationId); } catch (err) { console.error('mail dispatch failed: ' + (err && err.name)); } // row is stored; trigger retries
  }
  return { status: replay ? 'replay' : 'created', registrationId: registrationId };
}

// ---------- validation / crypto helpers ----------

function parsePayload_(text) {
  var p;
  try { p = JSON.parse(text); } catch (x) { return null; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  var keys = Object.keys(p);
  if (keys.length !== PAYLOAD_KEYS.length) return null;
  for (var i = 0; i < PAYLOAD_KEYS.length; i++) if (typeof p[PAYLOAD_KEYS[i]] !== 'string') return null;
  if (!/^[0-9]{8,15}$/.test(p.mobile)) return null;
  if (p.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return null;
  if (p.full_name.length < 2 || p.full_name.length > 100 || /[0-9]/.test(p.full_name)) return null;
  if (p.expertise.length < 2 || p.expertise.length > 160 || /[0-9]/.test(p.expertise)) return null;
  if (['he', 'en', 'ru'].indexOf(p.lang) < 0) return null;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(p.workshopId) || !/^[A-Za-z0-9._-]{1,64}$/.test(p.consentVersion)) return null;
  return p;
}

function toHex_(bytes) {
  return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}
function hmacHex_(secret, message) { return toHex_(Utilities.computeHmacSha256Signature(message, secret)); }
function sha256Hex_(text) { return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }

function constantTimeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Plain-text cell: neutralise control chars and formula triggers (=, +, -, @).
function cell_(value) {
  var s = String(value).replace(/[\t\r\n]+/g, ' ');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function uncell_(value) {
  var s = String(value);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

// ---------- sheet ----------

function getSheet_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  var header = sheet.getRange(1, 1, 1, COLUMNS.length);
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).setNumberFormat('@'); // plain text: keeps leading zeros, no formulas
    header.setValues([COLUMNS]);
  }
  return sheet;
}

function readRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues().map(function (values, idx) {
    var row = { _row: idx + 2 };
    COLUMNS.forEach(function (c, i) { row[c] = values[i]; });
    return row;
  });
}

function setCells_(sheet, rowNumber, changes) {
  Object.keys(changes).forEach(function (c) { sheet.getRange(rowNumber, COLUMNS.indexOf(c) + 1).setValue(changes[c]); });
}

// ---------- mail ----------

var TEXT = {
  he: {
    subject: 'קיבלנו את פרטיך להכשרה', dir: 'rtl', hi: 'שלום', received: 'קיבלנו את הפרטים שלך. זו אינה אישור תשלום או שריון מקום.',
    recorded: 'הפרטים שנרשמו', labels: { full_name: 'שם מלא', mobile: 'טלפון', email: 'דוא״ל', expertise: 'תחום התמחות' },
    event: 'המפגש הראשון: 16 בנובמבר 2026. ההכשרה כוללת שני מפגשים, ארבע שעות בסך הכול. מועד המפגש השני יימסר בהמשך.',
    next: 'פרטי ההמשך יישלחו בנפרד.', calendar: 'הוספה ליומן Google', reg: 'מספר פנייה'
  },
  en: {
    subject: 'We received your details for the training', dir: 'ltr', hi: 'Hello', received: 'We received your details. This is not a payment or seat confirmation.',
    recorded: 'Details recorded', labels: { full_name: 'Full name', mobile: 'Phone', email: 'Email', expertise: 'Area of expertise' },
    event: 'First session: 16 November 2026. The training has two sessions, four hours in total. The second session date will be announced.',
    next: 'Next steps will be sent separately.', calendar: 'Add to Google Calendar', reg: 'Reference'
  },
  ru: {
    subject: 'Мы получили ваши данные для обучения', dir: 'ltr', hi: 'Здравствуйте', received: 'Мы получили ваши данные. Это не подтверждение оплаты и не бронь места.',
    recorded: 'Записанные данные', labels: { full_name: 'Полное имя', mobile: 'Телефон', email: 'Эл. почта', expertise: 'Область специализации' },
    event: 'Первая встреча: 16 ноября 2026. Обучение состоит из двух встреч, всего четыре часа. Дата второй встречи будет сообщена позже.',
    next: 'Дальнейшие шаги будут отправлены отдельно.', calendar: 'Добавить в Google Календарь', reg: 'Номер заявки'
  }
};

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Returns a Google Calendar template URL only when start, end and timezone are all validly configured; otherwise ''.
function calendarLink_(props) {
  var start = props.getProperty('EVENT_START_ISO'), end = props.getProperty('EVENT_END_ISO'), tz = props.getProperty('EVENT_TIMEZONE');
  var iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  if (!start || !end || !tz || !iso.test(start) || !iso.test(end) || !/^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)+$/.test(tz) || end <= start) return '';
  var fmt = function (s) { var d = s.replace(/[-:]/g, ''); return d.length === 13 ? d + '00' : d; };
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Social media self-marketing training for lawyers') +
    '&dates=' + fmt(start) + '/' + fmt(end) + '&ctz=' + encodeURIComponent(tz);
}

function registrantMessage_(row, props) {
  var t = TEXT[row.lang] || TEXT.en;
  var link = calendarLink_(props);
  var fields = ['full_name', 'mobile', 'email', 'expertise'];
  var plain = [t.hi + ' ' + uncell_(row.full_name), '', t.received, '', t.recorded + ':']
    .concat(fields.map(function (f) { return '- ' + t.labels[f] + ': ' + uncell_(row[f]); }))
    .concat(['', t.event, t.next, t.reg + ': ' + row.registrationId]);
  var html = '<div dir="' + t.dir + '"><p>' + esc_(t.hi) + ' ' + esc_(uncell_(row.full_name)) + '</p><p><strong>' + esc_(t.received) + '</strong></p><p>' + esc_(t.recorded) + ':</p><ul>' +
    fields.map(function (f) { return '<li>' + esc_(t.labels[f]) + ': ' + esc_(uncell_(row[f])) + '</li>'; }).join('') + '</ul><p>' + esc_(t.event) + '</p>';
  if (link) { plain.push('', t.calendar + ': ' + link); html += '<p><a href="' + esc_(link) + '">' + esc_(t.calendar) + '</a></p>'; }
  html += '<p>' + esc_(t.next) + '</p><p>' + esc_(t.reg) + ': ' + esc_(row.registrationId) + '</p></div>';
  return { to: uncell_(row.email), subject: t.subject, body: plain.join('\n'), htmlBody: html };
}

// Owner mail carries the private sheet link and the reference only; never participant details.
function ownerMessage_(row, props) {
  var url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(props.getProperty('SHEET_ID')) + '/edit';
  var body = 'התקבלה הרשמה חדשה (' + row.registrationId + ', שפה: ' + row.lang + ', סדנה: ' + row.workshopId + ').\nהגיליון הפרטי: ' + url;
  return { to: props.getProperty('OWNER_EMAIL'), subject: 'הרשמה חדשה להכשרה', body: body,
    htmlBody: '<div dir="rtl"><p>התקבלה הרשמה חדשה (' + esc_(row.registrationId) + ', שפה: ' + esc_(row.lang) + ', סדנה: ' + esc_(row.workshopId) + ').</p><p><a href="' + esc_(url) + '">הגיליון הפרטי</a></p></div>' };
}

// Claim a pending mail under the lock (PENDING -> SENDING), send outside it, then record SENT or the failure.
function claimMail_(registrationId, kind) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var rows = readRows_(sheet).filter(function (r) { return r.registrationId === registrationId; });
    if (!rows.length) return null;
    var row = rows[0], state = String(row[kind]);
    var stale = state.indexOf('SENDING:') === 0 && Date.now() - Number(state.slice(8)) > SENDING_STALE_MS;
    if ((state !== 'PENDING' && !stale) || Number(row.mailAttempts) >= MAX_MAIL_ATTEMPTS) return null;
    if (MailApp.getRemainingDailyQuota() < 1) return null;
    setCells_(sheet, row._row, (function () { var c = {}; c[kind] = 'SENDING:' + Date.now(); return c; })());
    return row;
  } finally {
    lock.releaseLock();
  }
}

function finishMail_(registrationId, kind, ok) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var row = readRows_(sheet).filter(function (r) { return r.registrationId === registrationId; })[0];
    if (!row) return;
    var changes = { mailUpdatedAt: new Date().toISOString() };
    if (ok) changes[kind] = 'SENT';
    else {
      var attempts = Number(row.mailAttempts) + 1;
      changes.mailAttempts = attempts;
      changes[kind] = attempts >= MAX_MAIL_ATTEMPTS ? 'FAILED' : 'PENDING';
    }
    setCells_(sheet, row._row, changes);
  } finally {
    lock.releaseLock();
  }
}

function dispatchMails_(registrationId) {
  var props = PropertiesService.getScriptProperties();
  ['ownerMail', 'registrantMail'].forEach(function (kind) {
    var row = claimMail_(registrationId, kind);
    if (!row) return;
    var ok = false;
    try {
      var msg = kind === 'ownerMail' ? ownerMessage_(row, props) : registrantMessage_(row, props);
      if (!msg.to) throw new Error('no recipient');
      MailApp.sendEmail({ to: msg.to, subject: msg.subject, body: msg.body, htmlBody: msg.htmlBody, name: 'קטיה אלון | Katya Alon', replyTo: 'katya.shivuk@gmail.com' });
      ok = true;
    } catch (err) {
      console.error('mail failed (' + kind + '): ' + (err && err.name));
    }
    finishMail_(registrationId, kind, ok);
  });
}

// Time-driven trigger target: retry mails that are PENDING (or stuck in SENDING).
function retryPendingMails() {
  var rows = readRows_(getSheet_()).filter(function (r) {
    return Number(r.mailAttempts) < MAX_MAIL_ATTEMPTS && [r.ownerMail, r.registrantMail].some(function (s) { return s === 'PENDING' || String(s).indexOf('SENDING:') === 0; });
  }).slice(0, RETRY_BATCH);
  rows.forEach(function (r) { dispatchMails_(r.registrationId); });
}

// Run once by the owner from the editor.
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'retryPendingMails') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('retryPendingMails').timeBased().everyMinutes(15).create();
}
