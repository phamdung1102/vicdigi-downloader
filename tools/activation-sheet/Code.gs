// ============================================================
// VICdigi Activation Tracker — Google Apps Script
// Dán file này vào Apps Script gắn với Google Sheet của bạn,
// deploy làm Web App. App VICdigi sẽ POST sự kiện về đây.
// Xem TRACKING_GUIDE.md ở gốc project để biết các bước.
//
// Tạo/duy trì 2 sheet:
//  - "Thiết bị": mỗi máy 1 dòng (upsert theo Machine ID) — nhìn vào
//    đây là biết bao nhiêu máy đã kích hoạt, hạn dùng, lần cuối mở app.
//  - "Log": ghi thô mọi sự kiện (kích hoạt + heartbeat hằng ngày).
// ============================================================

var DEVICE_SHEET = 'Thiết bị';
var LOG_SHEET = 'Log';

var DEVICE_HEADERS = [
  'Machine ID', 'Tên khách', 'Email', 'Gói', 'Trạng thái',
  'Ngày phát hành', 'Ngày hết hạn', 'Kích hoạt lần đầu',
  'Lần cuối mở app', 'Phiên bản app', 'Số lần kích hoạt'
];
var LOG_HEADERS = [
  'Thời gian', 'Sự kiện', 'Machine ID', 'Tên khách', 'Email',
  'Gói', 'Trạng thái', 'Ngày hết hạn', 'Phiên bản app'
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (!data.machineId) throw new Error('Thiếu machineId');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    appendLog(ss, data);
    upsertDevice(ss, data);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Mở URL web app bằng trình duyệt để kiểm tra nhanh còn sống không
function doGet() {
  return ContentService.createTextOutput('VICdigi activation tracker OK');
}

function getSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLog(ss, data) {
  var sheet = getSheet(ss, LOG_SHEET, LOG_HEADERS);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.event || '',
    data.machineId,
    data.customerName || '',
    data.email || '',
    data.plan || '',
    data.licenseStatus || '',
    data.expiresAt || '',
    data.appVersion || ''
  ]);
}

function upsertDevice(ss, data) {
  var sheet = getSheet(ss, DEVICE_SHEET, DEVICE_HEADERS);
  var now = data.timestamp || new Date().toISOString();
  var lastRow = sheet.getLastRow();
  var rowIndex = -1;

  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === data.machineId) { rowIndex = i + 2; break; }
    }
  }

  if (rowIndex === -1) {
    sheet.appendRow([
      data.machineId,
      data.customerName || '',
      data.email || '',
      data.plan || '',
      data.licenseStatus || '',
      data.issuedAt || '',
      data.expiresAt || 'Vĩnh viễn',
      now,          // kích hoạt lần đầu
      now,          // lần cuối mở app
      data.appVersion || '',
      data.event === 'activate' ? 1 : 0
    ]);
    return;
  }

  // Cập nhật dòng đã có
  sheet.getRange(rowIndex, 2).setValue(data.customerName || sheet.getRange(rowIndex, 2).getValue());
  sheet.getRange(rowIndex, 3).setValue(data.email || sheet.getRange(rowIndex, 3).getValue());
  sheet.getRange(rowIndex, 4).setValue(data.plan || sheet.getRange(rowIndex, 4).getValue());
  sheet.getRange(rowIndex, 5).setValue(data.licenseStatus || '');
  if (data.issuedAt) sheet.getRange(rowIndex, 6).setValue(data.issuedAt);
  sheet.getRange(rowIndex, 7).setValue(data.expiresAt || 'Vĩnh viễn');
  sheet.getRange(rowIndex, 9).setValue(now);
  sheet.getRange(rowIndex, 10).setValue(data.appVersion || '');
  if (data.event === 'activate') {
    var count = Number(sheet.getRange(rowIndex, 11).getValue() || 0);
    sheet.getRange(rowIndex, 11).setValue(count + 1);
  }
}
