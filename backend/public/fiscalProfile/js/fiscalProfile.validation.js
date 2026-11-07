// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.validation.js                                    ║
// ║ MODULE: Fiscal Profile — Validation                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const RATE_LABELS = Object.freeze({
  icms_rate: 'Alíquota ICMS',
  icms_base_pct: 'Base de cálculo do ICMS',
  pis_rate: 'Alíquota PIS',
  cofins_rate: 'Alíquota COFINS',
  ipi_rate: 'Alíquota IPI',
  icms_st_base_pct: 'Base ST',
  icms_st_rate: 'Alíquota ST',
  icms_st_ret_base_pct: 'Base ST retido',
  icms_st_ret_rate: 'Alíquota ST retido',
});

const CST_FIELDS = Object.freeze({
  icms_cst: 'O CST/CSOSN do ICMS deve ter 2 ou 3 dígitos.',
  pis_cst: 'O CST do PIS deve ter 2 dígitos.',
  cofins_cst: 'O CST da COFINS deve ter 2 dígitos.',
});

export function validateFiscalProfile(payload) {
  const errors = [];

  if (!payload?.profile_name) {
    errors.push({ field: 'profile_name', message: 'Informe o nome do perfil fiscal.' });
  }

  Object.entries(CST_FIELDS).forEach(([key, message]) => {
    const pattern = key === 'icms_cst' ? /^\d{2,3}$/ : /^\d{2}$/;
    if (payload[key] && !pattern.test(payload[key])) errors.push({ field: key, message });
  });

  ['cfop_entry', 'cfop_exit'].forEach((key) => {
    if (payload[key] && !/^\d{4}$/.test(String(payload[key]).replace(/\D/g, ''))) {
      errors.push({ field: key, message: 'O CFOP deve ter 4 dígitos.' });
    }
  });

  Object.entries(RATE_LABELS).forEach(([key, label]) => {
    if (payload[key] == null) return;
    const rate = Number(payload[key]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      errors.push({ field: key, message: `${label} deve estar entre 0 e 100%.` });
    }
  });
  if (payload.mva_pct != null && !(Number(payload.mva_pct) >= 0)) {
    errors.push({ field: 'mva_pct', message: 'A MVA não pode ser negativa.' });
  }

  return { isValid: errors.length === 0, errors };
}
