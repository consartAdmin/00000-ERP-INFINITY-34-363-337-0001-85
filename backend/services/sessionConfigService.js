// Backend/services/sessionConfigService.js
const repo = require('../repositories/sessionConfigRepo');

const DEFAULTS = {
  enabled: true,
  idle_minutes: 10,
  warn_seconds: 0,
  silent: true,
  redirect_url: '/public/login/login.html',
};

function normalize(input = {}) {
  return {
    enabled: Boolean(input.enabled ?? DEFAULTS.enabled),
    idle_minutes: Number(input.idle_minutes ?? DEFAULTS.idle_minutes),
    warn_seconds: Number(input.warn_seconds ?? DEFAULTS.warn_seconds),
    silent: Boolean(input.silent ?? DEFAULTS.silent),
    redirect_url: String(input.redirect_url || DEFAULTS.redirect_url),
  };
}

function validate(cfg) {
  if (cfg.idle_minutes < 1 || !Number.isFinite(cfg.idle_minutes)) throw new Error('idle_minutes inválido');
  if (cfg.warn_seconds < 0 || !Number.isFinite(cfg.warn_seconds)) throw new Error('warn_seconds inválido');
  if (!cfg.redirect_url) throw new Error('redirect_url obrigatório');
}

async function get() {
  const row = await repo.getConfig();
  return row ? row : { ...DEFAULTS };
}

async function update(input, userId) {
  const cfg = normalize(input);
  validate(cfg);
  return repo.upsertConfig(cfg, userId);
}

module.exports = { get, update };
