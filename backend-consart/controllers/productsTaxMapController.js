// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsTaxMapController.js — alíquotas de venda por SKU (ESM)       ║
// ║ Usado pelo modal Rentabilidade do Orçamento (public/budgets).        ║
// ║ Fonte: productsFiscal (registro atual do produto) com fallback no    ║
// ║ fiscalProfile, igual ao motor salesTaxCalculationService.            ║
// ║ Lê as linhas com to_jsonb(...) para não depender de colunas que      ║
// ║ podem não existir em todos os bancos (Infinity / CONSART).           ║
// ║                                                                      ║
// ║ GET /api/products/tax-map?codes=00006074,00008395                    ║
// ║ → { ok:true, data:{ "00006074": { icms, reducao_bc, pis, cofins,     ║
// ║      ipi, fcp, profile_name, ncm, cst }, ... } }                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../config/db.js';

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** primeiro valor numérico (null/'' não contam) */
function pickNum(...values) {
  for (const v of values) if (isNum(v)) return Number(v);
  return 0;
}

function pickStr(...values) {
  for (const v of values) {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (s) return s;
  }
  return null;
}

const isTrue = (v) => v === true || v === 't' || v === 'true' || v === 1;
const isFalse = (v) => v === false || v === 'f' || v === 'false' || v === 0;

/** Melhor registro fiscal do produto: ativo, atual, mais recente. */
function rank(pf) {
  return [
    isFalse(pf.is_active) ? 0 : 1,
    isFalse(pf.is_current) ? 0 : 1,
    Date.parse(pf.updated_at || pf.created_at || 0) || 0,
    Number(pf.products_fiscal_id || 0),
  ];
}

function better(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i];
  }
  return false;
}

async function loadProfiles(ids) {
  if (!ids.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT to_jsonb(fp) AS fp FROM public."fiscalProfile" fp
        WHERE (to_jsonb(fp)->>'fiscal_profile_id') = ANY($1::text[])`,
      [ids.map(String)],
    );
    return Object.fromEntries(rows.map((r) => [String(r.fp.fiscal_profile_id), r.fp]));
  } catch (err) {
    console.warn('[products][tax-map] fiscalProfile indisponível:', err.message);
    return {};
  }
}

export async function getTaxMap(req, res) {
  try {
    const raw = String(req.query.codes || req.query.skus || '');
    const codes = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 500);

    if (!codes.length) return res.json({ ok: true, data: {} });

    const best = {};
    const errors = [];
    const keep = (code, pf) => {
      if (!code || !pf) return;
      if (!best[code] || better(pf, best[code])) best[code] = pf;
    };
    // cada consulta é independente: se uma falhar (coluna/tabela ausente) as outras seguem
    const tryQuery = async (label, sql, params) => {
      try {
        const { rows } = await pool.query(sql, params);
        return rows;
      } catch (err) {
        errors.push(`${label}: ${err.message}`);
        console.warn(`[products][tax-map] ${label}:`, err.message);
        return [];
      }
    };

    // 1) productsFiscal.product_code
    for (const r of await tryQuery(
      'productsFiscal.product_code',
      `SELECT TRIM(to_jsonb(pf)->>'product_code') AS code, to_jsonb(pf) AS pf
         FROM public."productsFiscal" pf
        WHERE TRIM(to_jsonb(pf)->>'product_code') = ANY($1::text[])`,
      [codes],
    )) keep(r.code, r.pf);

    // 2) productsFiscal.product_id ou products.products_fiscal_id
    const missing = codes.filter((c) => !best[c]);
    if (missing.length) {
      for (const r of await tryQuery(
        'products ↔ productsFiscal',
        `SELECT TRIM(p.product_code::text) AS code, to_jsonb(pf) AS pf
           FROM public."products" p
           JOIN public."productsFiscal" pf
             ON (to_jsonb(pf)->>'product_id') = (to_jsonb(p)->>'product_id')
             OR (to_jsonb(pf)->>'products_fiscal_id') = (to_jsonb(p)->>'products_fiscal_id')
          WHERE TRIM(p.product_code::text) = ANY($1::text[])`,
        [missing],
      )) keep(r.code, r.pf);
    }

    if (!Object.keys(best).length && errors.length) {
      return res.status(500).json({ ok: false, error: `Erro ao buscar impostos dos produtos: ${errors.join(' | ')}` });
    }

    const profileIds = [...new Set(Object.values(best)
      .map((pf) => Number(pf.fiscal_profile_id))
      .filter((n) => Number.isInteger(n) && n > 0))];
    const profiles = await loadProfiles(profileIds);

    const data = {};
    for (const [code, pf] of Object.entries(best)) {
      const fp = profiles[String(pf.fiscal_profile_id)] || {};
      data[code] = {
        icms: pickNum(pf.aliquota_icms, pf.icms_rate, fp.icms_rate, fp.aliquota_icms),
        reducao_bc: pickNum(pf.reducao_bc, fp.reducao_bc),
        pis: pickNum(pf.pis_aliquota, pf.pis_rate, fp.pis_rate, fp.pis_aliquota),
        cofins: pickNum(pf.cofins_aliquota, pf.cofins_rate, fp.cofins_rate, fp.cofins_aliquota),
        ipi: pickNum(pf.ipi_aliquota, pf.ipi_rate, fp.ipi_aliquota, fp.ipi_rate),
        fcp: pickNum(pf.aliquota_fcp, pf.fcp_rate, fp.aliquota_fcp, fp.fcp_rate),
        profile_name: pickStr(pf.profile_name, fp.profile_name),
        ncm: pickStr(pf.ncm, pf.ncm_code),
        cst: pickStr(pf.cst_icms, pf.csosn, pf.icms_cst, fp.icms_cst),
      };
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[products][tax-map]', err);
    return res.status(500).json({
      ok: false,
      error: `Erro ao buscar impostos dos produtos: ${err.message}`,
    });
  }
}
