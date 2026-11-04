// ╔══════════════════════════════════════════════════════════════════════╗
// ║ blocoE.mapper.js — Mapeamento do Bloco E                           ║
// ║ Projeto: CONSART ERP                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  line,
  formatDateDDMMYYYY,
  formatDecimal,
} from '../spedFiscal.generator.js';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function mapBlocoE(ctx) {
  const apuracao = ctx.apuracao || {};
  const documents = Array.isArray(ctx.documents) ? ctx.documents : [];
  const rawBalance = toNumber(apuracao.vl_sld_apurado);

  // E110/VL_SLD_APURADO represents tax payable and cannot be negative.
  const assessedBalance = Math.max(rawBalance, 0);

  // A negative calculated balance is a credit to carry forward.
  const informedCreditToCarry = Math.max(
    toNumber(apuracao.vl_sld_credor_transportar),
    0,
  );

  const creditToCarry = Math.max(
    informedCreditToCarry,
    rawBalance < 0 ? Math.abs(rawBalance) : 0,
  );

  const lines = [line('E001', '0')];

  lines.push(line(
    'E100',
    formatDateDDMMYYYY(ctx.period?.dateStart),
    formatDateDDMMYYYY(ctx.period?.dateEnd),
  ));

  lines.push(line(
    'E110',
    formatDecimal(apuracao.vl_tot_debitos || 0),
    formatDecimal(apuracao.vl_aj_debitos || 0),
    formatDecimal(apuracao.vl_tot_aj_debitos || 0),
    formatDecimal(apuracao.vl_estornos_cred || 0),
    formatDecimal(apuracao.vl_tot_creditos || 0),
    formatDecimal(apuracao.vl_aj_creditos || 0),
    formatDecimal(apuracao.vl_tot_aj_creditos || 0),
    formatDecimal(apuracao.vl_estornos_deb || 0),
    formatDecimal(apuracao.vl_sld_credor_ant || 0),
    formatDecimal(assessedBalance),
    formatDecimal(apuracao.vl_tot_ded || 0),
    formatDecimal(apuracao.vl_icms_recolher || 0),
    formatDecimal(creditToCarry),
    formatDecimal(apuracao.debitos_especiais || 0),
  ));

  const hasIcmsStMovement = documents.some(document => (
    toNumber(document.valor_bc_icms_st) > 0
    || toNumber(document.valor_icms_st) > 0
    || (Array.isArray(document.items) && document.items.some(item => (
      toNumber(item.valor_bc_icms_st) > 0
      || toNumber(item.valor_icms_st) > 0
    )))
  ));

  /*
   * E210: ICMS-ST das entradas (CFOP 1/2xxx) somado como no C190 — por
   * grupo CST|CFOP|alíquota e arredondado a 2 casas, igual ao PVA.
   * Devoluções/retornos (x410, x411, x414, x415, x660–x662) vão para
   * VL_DEVOL_ST; as demais entradas para VL_OUT_CRED_ST.
   */
  const ST_DEVOLUTION_CFOP_SUFFIXES = new Set(['410', '411', '414', '415', '660', '661', '662']);
  const round2 = value => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

  let inboundIcmsStDevolution = 0;
  let inboundIcmsStOtherCredit = 0;

  for (const document of documents) {
    const groups = new Map();

    for (const item of Array.isArray(document.items) ? document.items : []) {
      const cfop = String(item.cfop || '');
      if (!/^[12]/.test(cfop)) continue;

      const key = [item.cst_icms || item.csosn || '', cfop, item.aliq_icms ?? 0].join('|');
      groups.set(key, {
        cfop,
        st: (groups.get(key)?.st || 0) + toNumber(item.valor_icms_st),
      });
    }

    for (const group of groups.values()) {
      if (ST_DEVOLUTION_CFOP_SUFFIXES.has(group.cfop.slice(1))) {
        inboundIcmsStDevolution += round2(group.st);
      } else {
        inboundIcmsStOtherCredit += round2(group.st);
      }
    }
  }

  inboundIcmsStDevolution = round2(inboundIcmsStDevolution);
  inboundIcmsStOtherCredit = round2(inboundIcmsStOtherCredit);
  const inboundIcmsStCredit = round2(inboundIcmsStDevolution + inboundIcmsStOtherCredit);

  if (hasIcmsStMovement) {
    lines.push(line(
      'E200',
      String(ctx.company?.uf || '').trim().toUpperCase(),
      formatDateDDMMYYYY(ctx.period?.dateStart),
      formatDateDDMMYYYY(ctx.period?.dateEnd),
    ));

    // The imported ICMS-ST was retained by the suppliers. It creates movement
    // for the substituted taxpayer, but not an ICMS-ST debt to be collected.
    lines.push(line(
      'E210',
      '1',
      formatDecimal(0),
      formatDecimal(inboundIcmsStDevolution),
      formatDecimal(0),
      formatDecimal(inboundIcmsStOtherCredit),
      formatDecimal(0),
      formatDecimal(0),
      formatDecimal(0),
      formatDecimal(0),
      formatDecimal(0),
      formatDecimal(0),
      formatDecimal(0),
      formatDecimal(inboundIcmsStCredit),
      formatDecimal(0),
    ));
  }

  return lines;
}
