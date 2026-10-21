// ╔════════════════════════════════════════════════════════════════════╗
// ║ erpCompany.js — Empresa da tela (BH3 x CONSART)                    ║
// ║ 'BH3'     = cadastros originais (padrão)                           ║
// ║ 'CONSART' = cadastros da Consart ERP                               ║
// ║ As telas da Consart enviam o header X-ERP-Company                  ║
// ║ (/public/includes/js/erpCompany.js) ou ?company=CONSART.           ║
// ╚════════════════════════════════════════════════════════════════════╝

// backend-consart/: este servidor é só da CONSART (banco próprio), então
// toda request usa as tabelas da Consart, com ou sem header.
export const ERP_COMPANY_DEFAULT = 'CONSART';
export const ERP_COMPANIES = ['CONSART'];

export function normalizeErpCompany(v) {
  const c = String(v || '').trim().toUpperCase();
  return ERP_COMPANIES.includes(c) ? c : ERP_COMPANY_DEFAULT;
}

export function getErpCompany(req) {
  return normalizeErpCompany(req.get('x-erp-company') || req.query?.company);
}
