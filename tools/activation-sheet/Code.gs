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
var CODE_SHEET = 'Cấp phép';

var APP_ID = 'vicdigi-downloader';
var TOKEN_PREFIX = 'VDL1';

var CODE_HEADERS = [
  'Mã kích hoạt', 'Số ngày (hoặc lifetime)', 'Tên khách', 'Email',
  'Trạng thái', 'Machine ID đã dùng', 'Ngày cấp', 'Ghi chú'
];

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

    // Kích hoạt online: đổi mã lấy license token
    if (data.action === 'issue') {
      return jsonOut(handleIssue(data));
    }

    // Mặc định: ghi nhận sự kiện theo dõi (activate / heartbeat)
    if (!data.machineId) throw new Error('Thiếu machineId');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    appendLog(ss, data);
    upsertDevice(ss, data);
    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Phát license online ──────────────────────────────────────
function handleIssue(data) {
  var code = String(data.code || '').trim();
  var machineId = String(data.machineId || '').trim();
  if (!code) return { ok: false, error: 'Thiếu mã kích hoạt.' };
  if (!machineId) return { ok: false, error: 'Thiếu mã máy.' };

  var privateKey = PropertiesService.getScriptProperties().getProperty('PRIVATE_KEY');
  if (!privateKey) return { ok: false, error: 'Máy chủ chưa cấu hình private key.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheet(ss, CODE_SHEET, CODE_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Mã kích hoạt không tồn tại.' };

  var rows = sheet.getRange(2, 1, lastRow - 1, CODE_HEADERS.length).getValues();
  var rowIndex = -1, row = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === code) { rowIndex = i + 2; row = rows[i]; break; }
  }
  if (!row) return { ok: false, error: 'Mã kích hoạt không tồn tại.' };

  var status = String(row[4] || '').trim().toLowerCase();
  var usedMachine = String(row[5] || '').trim();

  // Đã dùng trên máy khác → từ chối. Cùng máy → cho kích hoạt lại.
  if (usedMachine && usedMachine !== machineId) {
    return { ok: false, error: 'Mã này đã được kích hoạt trên máy khác.' };
  }
  if (status === 'khóa' || status === 'locked' || status === 'revoked') {
    return { ok: false, error: 'Mã kích hoạt đã bị khóa.' };
  }

  var durationRaw = String(row[1] || '').trim().toLowerCase();
  var isLifetime = (durationRaw === 'lifetime' || durationRaw === 'vĩnh viễn' || durationRaw === '');
  var days = isLifetime ? null : parseInt(durationRaw, 10);
  if (!isLifetime && (!isFinite(days) || days <= 0)) {
    return { ok: false, error: 'Cấu hình số ngày của mã không hợp lệ.' };
  }

  var now = new Date();
  var payload = {
    appId: APP_ID,
    machineId: machineId,
    customerName: String(row[2] || '').trim(),
    email: String(row[3] || '').trim(),
    issuedAt: now.toISOString(),
    expiresAt: isLifetime ? null : new Date(now.getTime() + days * 86400000).toISOString(),
    plan: isLifetime ? 'lifetime' : (days + '-day'),
    features: ['downloads']
  };

  var token = signToken(payload, privateKey);

  // Đánh dấu mã đã dùng
  sheet.getRange(rowIndex, 5).setValue('đã dùng');
  sheet.getRange(rowIndex, 6).setValue(machineId);
  sheet.getRange(rowIndex, 7).setValue(now.toISOString());

  // Ghi log + cập nhật thiết bị
  var trackData = {
    event: 'activate-online', machineId: machineId,
    customerName: payload.customerName, email: payload.email,
    plan: payload.plan, licenseStatus: 'active',
    issuedAt: payload.issuedAt, expiresAt: payload.expiresAt,
    appVersion: data.appVersion || '', timestamp: now.toISOString()
  };
  appendLog(ss, trackData);
  upsertDevice(ss, trackData);

  return { ok: true, token: token };
}

// Ký token đúng định dạng app: VDL1.<payloadBase64url>.<sigBase64url>
function signToken(payload, privateKey) {
  var pem = normalizePem_(privateKey);
  var payloadEncoded = base64UrlEncode_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  var sigBytes = Utilities.computeRsaSha256Signature(payloadEncoded, pem);
  var sigEncoded = base64UrlEncode_(sigBytes);
  return TOKEN_PREFIX + '.' + payloadEncoded + '.' + sigEncoded;
}

// Dựng lại PEM chuẩn (xuống dòng 64 ký tự) phòng khi Script Properties
// làm mất dấu xuống dòng khi lưu key.
function normalizePem_(raw) {
  var s = String(raw || '').trim();
  var typeMatch = s.match(/-----BEGIN ([A-Z0-9 ]+?)-----/);
  var type = typeMatch ? typeMatch[1] : 'PRIVATE KEY';
  var body = s
    .replace(/-----BEGIN [A-Z0-9 ]+-----/, '')
    .replace(/-----END [A-Z0-9 ]+-----/, '')
    .replace(/\s+/g, '');
  var lines = body.match(/.{1,64}/g) || [];
  return '-----BEGIN ' + type + '-----\n' + lines.join('\n') + '\n-----END ' + type + '-----';
}

function base64UrlEncode_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

// Mở URL web app bằng trình duyệt để kiểm tra nhanh còn sống không
function doGet() {
  return ContentService.createTextOutput('VICdigi activation tracker OK v3-pemfix');
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
