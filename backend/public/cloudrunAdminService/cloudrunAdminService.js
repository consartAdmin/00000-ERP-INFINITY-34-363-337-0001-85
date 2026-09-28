const API = {
  status: '/internal/cloudrun/status',
  on: '/internal/cloudrun/on',
  off: '/internal/cloudrun/off',
  schedulerGet: '/internal/cloudrun/scheduler',
  schedulerOn: '/internal/cloudrun/scheduler/on',
  schedulerOff: '/internal/cloudrun/scheduler/off'
};

const els = {
  adminToken: document.getElementById('adminToken'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnTurnOn: document.getElementById('btnTurnOn'),
  btnTurnOff: document.getElementById('btnTurnOff'),
  btnSaveOnSchedule: document.getElementById('btnSaveOnSchedule'),
  btnSaveOffSchedule: document.getElementById('btnSaveOffSchedule'),
  apiResponse: document.getElementById('apiResponse'),
  serviceBadge: document.getElementById('serviceBadge'),
  statusProject: document.getElementById('statusProject'),
  statusRegion: document.getElementById('statusRegion'),
  statusService: document.getElementById('statusService'),
  statusMode: document.getElementById('statusMode'),
  statusInstances: document.getElementById('statusInstances'),
  statusUpdatedAt: document.getElementById('statusUpdatedAt'),
  onTime: document.getElementById('onTime'),
  offTime: document.getElementById('offTime'),
  onWeekdaysOnly: document.getElementById('onWeekdaysOnly'),
  offEveryday: document.getElementById('offEveryday'),
  previewOnCron: document.getElementById('previewOnCron'),
  previewOffCron: document.getElementById('previewOffCron'),
  toastArea: document.getElementById('toastArea')
};

function getToken() {
  return (els.adminToken.value || '').trim();
}

function buildHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'x-consart-token': token
  };
}

function showToast(message, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = message;
  els.toastArea.prepend(div);

  setTimeout(() => {
    div.remove();
  }, 4500);
}

function setLoadingButtons(isLoading) {
  [
    els.btnRefresh,
    els.btnTurnOn,
    els.btnTurnOff,
    els.btnSaveOnSchedule,
    els.btnSaveOffSchedule
  ].forEach(btn => {
    btn.disabled = isLoading;
  });
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function cronFromTime(timeValue, weekdaysOnly = false, everyday = false) {
  const [hour, minute] = timeValue.split(':').map(Number);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return '';
  }

  if (everyday) {
    return `${minute} ${hour} * * *`;
  }

  if (weekdaysOnly) {
    return `${minute} ${hour} * * 1-5`;
  }

  return `${minute} ${hour} * * *`;
}

function updatePreview() {
  els.previewOnCron.textContent = cronFromTime(els.onTime.value, els.onWeekdaysOnly.checked, false);
  els.previewOffCron.textContent = cronFromTime(els.offTime.value, false, els.offEveryday.checked);
}

function updateStatusCard(payload) {
  const config = payload?.config || payload || {};
  const project = config.project || '--';
  const region = config.region || '--';
  const service = config.service || '--';

  const mode =
    config.scalingMode ||
    config.mode ||
    (typeof config.minInstances !== 'undefined' ? 'AUTO' : '--');

  const instances =
    typeof config.minInstances !== 'undefined'
      ? String(config.minInstances)
      : (typeof config.manualInstances !== 'undefined' ? String(config.manualInstances) : '--');

  const updatedAt =
    config.updatedAt ||
    config.lastUpdateTime ||
    config.userUpdateTime ||
    '--';

  els.statusProject.textContent = project;
  els.statusRegion.textContent = region;
  els.statusService.textContent = service;
  els.statusMode.textContent = mode;
  els.statusInstances.textContent = instances;
  els.statusUpdatedAt.textContent = updatedAt;

  const badge = els.serviceBadge;
  badge.className = 'badge badge-neutral';

  if (mode && String(mode).toUpperCase().includes('MANUAL')) {
    badge.textContent = 'Manual';
    badge.classList.add('badge-success');
    return;
  }

  if (typeof config.minInstances !== 'undefined' && Number(config.minInstances) === 0) {
    badge.textContent = 'Sem aquecimento';
    badge.classList.add('badge-danger');
    return;
  }

  badge.textContent = 'Ativo';
  badge.classList.add('badge-success');
}

async function request(url, options = {}) {
  const token = getToken();

  if (!token) {
    throw new Error('Informe o token administrativo.');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  els.apiResponse.textContent = formatJson(data);

  if (!response.ok) {
    throw new Error(data?.error || `Falha HTTP ${response.status}`);
  }

  return data;
}

async function loadStatus() {
  setLoadingButtons(true);
  try {
    const data = await request(API.status, { method: 'GET' });
    updateStatusCard(data);
    showToast('Status carregado com sucesso.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setLoadingButtons(false);
  }
}

async function turnOn() {
  setLoadingButtons(true);
  try {
    const data = await request(API.on, {
      method: 'POST',
      body: JSON.stringify({})
    });
    updateStatusCard({
      config: {
        project: data.project,
        region: data.region,
        service: data.service,
        mode: 'MANUAL',
        manualInstances: 1,
        updatedAt: new Date().toISOString()
      }
    });
    showToast('Serviço ligado com sucesso.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setLoadingButtons(false);
  }
}

async function turnOff() {
  setLoadingButtons(true);
  try {
    const data = await request(API.off, {
      method: 'POST',
      body: JSON.stringify({})
    });
    updateStatusCard({
      config: {
        project: data.project,
        region: data.region,
        service: data.service,
        mode: 'MANUAL',
        manualInstances: 0,
        updatedAt: new Date().toISOString()
      }
    });
    showToast('Serviço desligado com sucesso.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setLoadingButtons(false);
  }
}

async function saveOnSchedule() {
  setLoadingButtons(true);
  try {
    const cron = cronFromTime(els.onTime.value, els.onWeekdaysOnly.checked, false);
    const payload = {
      time: els.onTime.value,
      cron,
      weekdaysOnly: els.onWeekdaysOnly.checked,
      timeZone: 'America/Sao_Paulo'
    };

    const data = await request(API.schedulerOn, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    els.apiResponse.textContent = formatJson(data);
    showToast('Agendamento de ligar salvo com sucesso.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setLoadingButtons(false);
  }
}

async function saveOffSchedule() {
  setLoadingButtons(true);
  try {
    const cron = cronFromTime(els.offTime.value, false, els.offEveryday.checked);
    const payload = {
      time: els.offTime.value,
      cron,
      everyday: els.offEveryday.checked,
      timeZone: 'America/Sao_Paulo'
    };

    const data = await request(API.schedulerOff, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    els.apiResponse.textContent = formatJson(data);
    showToast('Agendamento de desligar salvo com sucesso.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setLoadingButtons(false);
  }
}

els.btnRefresh.addEventListener('click', loadStatus);
els.btnTurnOn.addEventListener('click', turnOn);
els.btnTurnOff.addEventListener('click', turnOff);
els.btnSaveOnSchedule.addEventListener('click', saveOnSchedule);
els.btnSaveOffSchedule.addEventListener('click', saveOffSchedule);
els.onTime.addEventListener('input', updatePreview);
els.offTime.addEventListener('input', updatePreview);
els.onWeekdaysOnly.addEventListener('change', updatePreview);
els.offEveryday.addEventListener('change', updatePreview);

updatePreview();