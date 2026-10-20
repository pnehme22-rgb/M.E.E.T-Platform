/**
 * M.E.E.T. applications → Google Sheet mirror
 *
 * Setup (once):
 *  1. Create a Google Sheet in the minds.exploring.traditions account.
 *  2. Extensions › Apps Script. Replace everything with this file. Save.
 *  3. Project Settings (gear) › Script properties › Add property:
 *       SECRET = the same long random value you put in Supabase app_config
 *     (Stand-alone project at script.google.com instead? Also add
 *       SHEET_ID = the long code in the Sheet's address, between /d/ and /edit)
 *  4. Deploy › New deployment › type "Web app":
 *       Execute as: Me    Who has access: Anyone
 *     Copy the Web app URL into Supabase app_config (see SETUP.md).
 *
 * The database posts every new or changed application here. Rows are matched
 * by reference, so a status change updates the same row. The team console is
 * the source of truth: edits made in the Sheet are not sent back.
 */

var SHEET_NAME = 'Applications';
var COLUMNS = [
  ['reference', 'Reference'], ['status', 'Status'], ['created_at', 'Received'], ['artist_name', 'Artist name'],
  ['full_name', 'Full name'], ['email', 'Email'], ['country', 'Country'], ['city', 'City'],
  ['primary_discipline', 'Main discipline'], ['discipline_other', 'Discipline (if Other)'], ['practice', 'Practice'],
  ['additional_disciplines', 'Other disciplines'], ['techniques', 'Techniques and materials'], ['website', 'Website'], ['social', 'Social profile'],
  ['portfolio_links', 'More links'], ['interest_commissions', 'Open to commissions'],
  ['interest_collaboration', 'Open to collaboration'], ['heard_about', 'Found M.E.E.T. through'],
  ['possible_duplicate', 'Applied before'], ['reviewer', 'Reviewer'], ['decided_at', 'Decided'],
  ['decision_note', 'Decision note'], ['invited_at', 'Studio link sent']
];
var STATUS_LABEL = {
  new: 'New', in_review: 'In review', more_info: 'More information requested', approved: 'Approved', declined: 'Declined'
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || data.secret !== secret) return text_('forbidden');
    if (!data.reference) return text_('missing reference');

    var sheet = sheet_();
    var row = COLUMNS.map(function (c) { return cell_(c[0], data[c[0]]); });

    var refs = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    var at = -1;
    for (var i = 0; i < refs.length; i++) { if (refs[i][0] === data.reference) { at = i + 2; break; } }
    if (at === -1) sheet.appendRow(row);
    else sheet.getRange(at, 1, 1, row.length).setValues([row]);
    return text_('ok');
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  // Works inside the Sheet (Extensions › Apps Script), or as a stand-alone
  // project at script.google.com with a SHEET_ID script property.
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(function (c) { return c[1]; }));
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold').setBackground('#f5efe1');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function cell_(key, v) {
  if (v === null || v === undefined) return '';
  if (key === 'status') return STATUS_LABEL[v] || v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (/_at$/.test(key) && v) return new Date(v);
  v = String(v);
  // Never let a typed value act as a spreadsheet formula.
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
