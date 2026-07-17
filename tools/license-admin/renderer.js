const api = window.licenseAdminAPI;

const $ = id => document.getElementById(id);

const state = {
  licenseKey: '',
  payload: null,
};

async function boot() {
  bindEvents();
  const response = await api.getConfig();
  const config = response?.config || {};
  updateDurationUi();

  if (!config.hasDefaultPrivateKey) {
    setStatus('Không tìm thấy private key mặc định trong bản cài đặt.', 'err');
    $('generateBtn').disabled = true;
    return;
  }

  setStatus('Sẵn sàng tạo khóa bản quyền.');
}

function bindEvents() {
  $('durationModeInput').addEventListener('change', updateDurationUi);
  $('generateBtn').addEventListener('click', generateLicense);
  $('copyBtn').addEventListener('click', copyLicense);
  $('saveBtn').addEventListener('click', saveLicense);
  document.querySelectorAll('.chip-btn').forEach(button => {
    button.addEventListener('click', () => {
      $('durationModeInput').value = 'days';
      $('daysInput').value = button.dataset.days;
      updateDurationUi();
    });
  });
}

function updateDurationUi() {
  const isLifetime = $('durationModeInput').value === 'lifetime';
  $('daysGroup').style.display = isLifetime ? 'none' : 'grid';
}

async function generateLicense() {
  try {
    const payload = collectFormData();
    const response = await api.generate(payload);
    const result = response?.result;
    if (!response?.success || !result?.licenseKey) {
      throw new Error('Không tạo được khóa bản quyền');
    }

    state.licenseKey = result.licenseKey;
    state.payload = result.payload;

    $('licenseOutput').value = result.licenseKey;
    $('resultCustomer').textContent = result.payload.customerName || '--';
    $('resultExpiry').textContent = result.payload.expiresAt
      ? new Date(result.payload.expiresAt).toLocaleDateString('vi-VN')
      : 'Không giới hạn';
    setStatus('Đã tạo khóa bản quyền thành công.', 'ok');
  } catch (error) {
    setStatus(error.message || String(error), 'err');
  }
}

async function copyLicense() {
  if (!state.licenseKey) return setStatus('Chưa có khóa bản quyền để sao chép.', 'warn');
  await api.copy(state.licenseKey);
  setStatus('Đã sao chép khóa bản quyền.', 'ok');
}

async function saveLicense() {
  if (!state.licenseKey || !state.payload) return setStatus('Chưa có khóa bản quyền để lưu.', 'warn');
  const response = await api.save({
    machineId: state.payload.machineId,
    durationMode: $('durationModeInput').value,
    days: $('daysInput').value,
    licenseKey: state.licenseKey,
  });
  if (response?.cancelled) return;
  if (!response?.success) return setStatus('Không lưu được tệp khóa.', 'err');
  setStatus(`Đã lưu khóa: ${response.filePath}`, 'ok');
}

function collectFormData() {
  const machineId = $('machineIdInput').value.trim();
  const customerName = $('customerNameInput').value.trim();
  const email = $('emailInput').value.trim();
  const durationMode = $('durationModeInput').value;
  const days = Number.parseInt($('daysInput').value || '0', 10);

  if (!machineId) throw new Error('Vui lòng nhập mã máy');
  if (durationMode === 'days' && (!Number.isFinite(days) || days <= 0)) {
    throw new Error('Số ngày phải lớn hơn 0');
  }

  return {
    machineId,
    customerName,
    email,
    durationMode,
    days,
  };
}

function setStatus(message, type = '') {
  const el = $('statusBar');
  el.textContent = message;
  el.className = `status${type ? ` ${type}` : ''}`;
}

boot().catch(error => {
  setStatus(error.message || String(error), 'err');
});
