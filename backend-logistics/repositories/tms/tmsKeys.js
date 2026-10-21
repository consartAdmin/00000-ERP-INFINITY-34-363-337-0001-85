// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsKeys.js — chave de acesso de 44 dígitos do CT-e (57) / MDF-e (58)║
// ║ cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) número(9) tpEmis(1)        ║
// ║ código numérico(8) DV(1) — DV por módulo 11 (pesos 2..9)           ║
// ╚════════════════════════════════════════════════════════════════════╝

import crypto from 'node:crypto';
import { httpError, onlyDigits } from './tms.helpers.js';

export const UF_CODES = Object.freeze({
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26,
  AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
});

export function mod11(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * @param {{ uf: string, date: string, cnpj: string, model: 57|58, series: number, number: number, code?: string }} p
 */
export function buildAccessKey({ uf, date, cnpj, model, series, number, code }) {
  const cUF = UF_CODES[String(uf || '').toUpperCase()];
  if (!cUF) throw httpError('EMITTER_UF_INVALID', 400);
  const doc = onlyDigits(cnpj).padStart(14, '0');
  if (doc.length !== 14) throw httpError('EMITTER_CNPJ_INVALID', 400);
  const [y, m] = String(date).slice(0, 7).split('-');
  const cNum = (code || String(crypto.randomInt(0, 99999999))).padStart(8, '0');
  const base = `${cUF}${y.slice(2)}${m}${doc}${String(model).padStart(2, '0')}`
    + `${String(series).padStart(3, '0')}${String(number).padStart(9, '0')}1${cNum}`;
  return `${base}${mod11(base)}`;
}

/** Emitente: primeira empresa ativa da tabela enterprises */
export async function loadEmitter(run) {
  try {
    const { rows: [e] } = await run(
      `SELECT razao_social, nome_fantasia, cnpj, ie, uf, endereco, numero, bairro, cep
         FROM public.enterprises
        ORDER BY is_active DESC NULLS LAST, id
        LIMIT 1`
    );
    if (e?.cnpj && e?.uf) return e;
  } catch {
    // tabela ausente: cai no erro abaixo
  }
  throw httpError('EMITTER_NOT_CONFIGURED', 409);
}
