// ╔════════════════════════════════════════════════════════════════════╗
// ║ accountsPayable.groups.js — Grupos de contas a pagar               ║
// ║ Classificação: grupo da categoria do título > folha > parcelamento ║
// ║ > grupo da categoria padrão do fornecedor > origem > palavras-chave║
// ╚════════════════════════════════════════════════════════════════════╝

export const PAYABLE_GROUPS = Object.freeze([
  { key: 'IMPOSTOS', label: 'Impostos e Tributos' },
  { key: 'PARCELAMENTOS', label: 'Parcelamentos' },
  { key: 'RH', label: 'R.H / Folha' },
  { key: 'FORNECEDORES', label: 'Fornecedores (mercadorias)' },
  { key: 'OPERACIONAIS', label: 'Despesas operacionais' },
  { key: 'FINANCEIRO', label: 'Financeiro e bancário' },
  { key: 'OUTROS', label: 'Outros / sem grupo' }
]);

export const PAYABLE_GROUP_KEYS = new Set(PAYABLE_GROUPS.map((g) => g.key));

export function normalizeGroupKey(v) {
  const key = String(v ?? '').trim().toUpperCase();
  return PAYABLE_GROUP_KEYS.has(key) ? key : null;
}

/** "IMPOSTOS,RH" | ['IMPOSTOS','RH'] → ['IMPOSTOS','RH'] (só chaves válidas) */
export function parseGroups(v) {
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return [...new Set(arr.map(normalizeGroupKey).filter(Boolean))];
}

// Origens geradas pela NF-e de entrada (mercadoria) e pela NF-e de despesa
const NFE_SOURCES = `('INBOUND_INSTALLMENT','NFE_ENTRY','INBOUND_NFE','NFE')`;

const RX_PARCELAMENTO =
  'PARCELAMENTO|PARCELAS|SISPAR|REFIS|\\mPERT\\M|\\mPAEX\\M|TRANSA[CÇ][AÃ]O TRIBUT';

const RX_RH =
  'FOLHA|SAL[AÁ]RIO|F[EÉ]RIAS|RESCIS|\\mFGTS\\M|\\mINSS\\M|PR[OÓ][ -]?LABORE|' +
  'VALE[ -]?TRANSPORTE|VALE[ -]?REFEI|VALE[ -]?ALIMENTA|D[EÉ]CIMO TERCEIRO|\\m13[ºO°]? ?SAL|' +
  'PLANO DE SA[UÚ]DE|EXAME (ADMISSIONAL|DEMISSIONAL|PERI[OÓ]DICO)|SINDICA';

const RX_IMPOSTOS =
  'RECEITA FEDERAL|SIMPLES NACIONAL|\\mDAS\\M|\\mDARF\\M|\\mGPS\\M|\\mDAE\\M|\\mGNRE\\M|' +
  'SEFAZ|SECRETARIA DA FAZENDA|FAZENDA ESTADUAL|\\mICMS\\M|\\mISS\\M|\\mISSQN\\M|\\mIPTU\\M|\\mIPVA\\M|' +
  'DETRAN|PREFEITURA|MUNIC[IÍ]PIO DE|IMPOSTO|TRIBUT|\\mTAXAS?\\M|\\mPGFN\\M|\\mIRPJ\\M|\\mCSLL\\M|' +
  '\\mPIS\\M|\\mCOFINS\\M|\\mDIFAL\\M';

const RX_FINANCEIRO =
  '\\mBANCO\\M|BANC[AÁ]RI|TARIFA|\\mJUROS\\M|EMPR[EÉ]STIMO|FINANCIAMENTO|\\mIOF\\M|' +
  'CART[AÃ]O DE CR[EÉ]DITO|CONS[OÓ]RCIO|LEASING|CAPITAL DE GIRO|CHEQUE ESPECIAL|PRONAMPE';

const RX_OPERACIONAIS =
  'ALUGUEL|LOCA[CÇ][AÃ]O|CONDOM[IÍ]NIO|ENERGIA|\\mLUZ\\M|CEMIG|\\mENEL\\M|COPASA|SABESP|' +
  '\\m[AÁ]GUA E ESGOTO|SANEAMENTO|TELEFON|INTERNET|TELECOM|\\mVIVO\\M|\\mCLARO\\M|\\mTIM\\M|' +
  'AUTO ?POSTO|\\mPOSTO\\M|COMBUST|GASOLINA|DIESEL|MANUTEN|SOFTWARE|SISTEMA|LICEN[CÇ]A|' +
  'CONTABILIDADE|CONT[AÁ]BIL|HONOR[AÁ]RIO|SEGURO|LIMPEZA|CORREIOS|\\mFRETE|TRANSPORTADORA|' +
  'ASSINATURA|PUBLICIDADE|MARKETING';

/**
 * Expressão SQL que resolve o grupo de cada título.
 * Requer os aliases: ap (accountsPayable), s (suppliers), ec/esc (categoria/sub
 * do título) e sc (categoria padrão do fornecedor).
 */
export function payableGroupSql() {
  const text = `UPPER(CONCAT_WS(' ', s.name, ap.description, ap.invoice_number, ap.document_number, ec.name, esc.name))`;
  return `(CASE
    WHEN ec.payable_group IS NOT NULL THEN ec.payable_group
    WHEN ap.source_type = 'PAYROLL' THEN 'RH'
    WHEN COALESCE(ap.source_type, '') NOT IN ${NFE_SOURCES}
         AND ${text} ~* '${RX_PARCELAMENTO}' THEN 'PARCELAMENTOS'
    WHEN sc.payable_group IS NOT NULL THEN sc.payable_group
    WHEN ap.source_type IN ${NFE_SOURCES} THEN 'FORNECEDORES'
    WHEN ap.source_type = 'EXPENSE_ENTRY' THEN 'OPERACIONAIS'
    WHEN ${text} ~* '${RX_RH}' THEN 'RH'
    WHEN ${text} ~* '${RX_IMPOSTOS}' THEN 'IMPOSTOS'
    WHEN ${text} ~* '${RX_FINANCEIRO}' THEN 'FINANCEIRO'
    WHEN ${text} ~* '${RX_OPERACIONAIS}' THEN 'OPERACIONAIS'
    ELSE 'OUTROS'
  END)`;
}
