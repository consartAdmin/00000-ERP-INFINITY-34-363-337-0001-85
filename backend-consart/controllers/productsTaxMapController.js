// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsTaxMapController.js — alíquotas de venda por SKU (ESM)       ║
// ║ Usado pelo modal Rentabilidade do Orçamento (public/budgets).        ║
// ║ Fonte: productsFiscal (registro atual do produto) com fallback no    ║
// ║ fiscalProfile, igual ao motor salesTaxCalculationService.            ║
// ║                                                                      ║
// ║ GET /api/products/tax-map?codes=00006074,00008395                    ║
// ║ → { ok:true, data:{ "00006074": { icms, reducao_bc, pis, cofins,     ║
// ║      ipi, fcp, profile_name, ncm, cst }, ... } }                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../config/db.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function getTaxMap(req, res) {
  try {
    const raw = String(req.query.codes || req.query.skus || '');
    const codes = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 500);

    if (!codes.length) return res.json({ ok: true, data: {} });

    const { rows } = await pool.query(
      `
        SELECT DISTINCT ON (TRIM(pf.product_code))
          TRIM(pf.product_code) AS product_code,
          COALESCE(pf.aliquota_icms, pf.icms_rate, fp.icms_rate, 0)     AS icms,
          COALESCE(pf.reducao_bc, 0)                                     AS reducao_bc,
          COALESCE(pf.pis_aliquota, pf.pis_rate, fp.pis_rate, 0)         AS pis,
          COALESCE(pf.cofins_aliquota, pf.cofins_rate, fp.cofins_rate, 0) AS cofins,
          COALESCE(pf.ipi_aliquota, 0)                                   AS ipi,
          COALESCE(pf.aliquota_fcp, 0)                                   AS fcp,
          COALESCE(NULLIF(TRIM(pf.profile_name), ''), fp.profile_name)   AS profile_name,
          COALESCE(NULLIF(TRIM(pf.ncm), ''), pf.ncm_code)                AS ncm,
          COALESCE(NULLIF(TRIM(pf.cst_icms), ''), NULLIF(TRIM(pf.csosn), ''), pf.icms_cst, fp.icms_cst) AS cst
        FROM public."productsFiscal" pf
        LEFT JOIN public."fiscalProfile" fp
          ON fp.fiscal_profile_id = pf.fiscal_profile_id
        WHERE TRIM(pf.product_code) = ANY($1::text[])
          AND COALESCE(pf.is_active, true) = true
        ORDER BY TRIM(pf.product_code),
                 COALESCE(pf.is_current, true) DESC,
                 pf.updated_at DESC NULLS LAST,
                 pf.products_fiscal_id DESC
      `,
      [codes],
    );

    const data = {};
    for (const r of rows) {
      data[String(r.product_code)] = {
        icms: num(r.icms),
        reducao_bc: num(r.reducao_bc),
        pis: num(r.pis),
        cofins: num(r.cofins),
        ipi: num(r.ipi),
        fcp: num(r.fcp),
        profile_name: r.profile_name || null,
        ncm: r.ncm || null,
        cst: r.cst || null,
      };
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[products][tax-map]', err);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar impostos dos produtos.' });
  }
}
