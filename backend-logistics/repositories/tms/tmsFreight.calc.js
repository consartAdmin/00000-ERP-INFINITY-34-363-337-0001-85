// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsFreight.calc.js — cálculo de frete pela tabela de frete         ║
// ║ Peso taxado = maior entre peso real e peso cubado (m³ × fator).    ║
// ║ Frete peso (PESO: fixo + R$/kg · KM: fixo + R$/km · FIXO: fixo)    ║
// ║ + ad valorem + GRIS (com mínimo) + pedágio por fração de 100 kg    ║
// ║ + taxas de coleta/entrega; respeita o frete mínimo; ICMS "por      ║
// ║ dentro" quando a tabela não inclui o imposto.                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { httpError, toInt, toNum, cleanText, round2 } from './tms.helpers.js';

const TABLES = 'public."tmsFreightTables"';
const RANGES = 'public."tmsFreightTableRanges"';

/**
 * @param {Function} run executor (pool.query ou client.query)
 * @param {object} input { table_id, origin_state, origin_city, destination_state, destination_city,
 *                         weight_kg, cubage_m3, cargo_value, distance_km }
 */
export async function calcFreight(run, input = {}) {
  const tableId = toInt(input.table_id);
  if (!tableId) throw httpError('TABLE_ID_REQUIRED', 400);

  const { rows: [table] } = await run(`SELECT * FROM ${TABLES} WHERE table_id = $1`, [tableId]);
  if (!table) throw httpError('FREIGHT_TABLE_NOT_FOUND', 404);

  const weight = toNum(input.weight_kg, 0);
  const cubage = toNum(input.cubage_m3, 0);
  const cargoValue = toNum(input.cargo_value, 0);
  const distance = toNum(input.distance_km, 0);
  const cubedWeight = cubage * Number(table.cubage_factor || 0);
  const taxable = Math.max(weight, cubedWeight);

  const { rows: [range] } = await run(
    `SELECT *
       FROM ${RANGES}
      WHERE table_id = $1
        AND (origin_state IS NULL OR origin_state = '' OR UPPER(origin_state) = UPPER($2))
        AND (origin_city IS NULL OR origin_city = '' OR LOWER(TRIM(origin_city)) = LOWER(TRIM($3)))
        AND (destination_state IS NULL OR destination_state = '' OR UPPER(destination_state) = UPPER($4))
        AND (destination_city IS NULL OR destination_city = '' OR LOWER(TRIM(destination_city)) = LOWER(TRIM($5)))
        AND weight_from <= $6
        AND (weight_to IS NULL OR weight_to >= $6)
      ORDER BY (NULLIF(destination_city, '') IS NOT NULL)::int + (NULLIF(origin_city, '') IS NOT NULL)::int DESC,
               (NULLIF(destination_state, '') IS NOT NULL)::int + (NULLIF(origin_state, '') IS NOT NULL)::int DESC,
               weight_from DESC
      LIMIT 1`,
    [
      tableId,
      cleanText(input.origin_state) || '', cleanText(input.origin_city) || '',
      cleanText(input.destination_state) || '', cleanText(input.destination_city) || '',
      taxable,
    ]
  );
  if (!range) throw httpError('NO_FREIGHT_RANGE', 404);

  let freightWeight = Number(range.fixed_price || 0);
  if (table.calc_mode === 'PESO') freightWeight += Number(range.price_per_kg || 0) * taxable;
  if (table.calc_mode === 'KM') freightWeight += Number(range.price_per_km || 0) * distance;

  const adValorem = cargoValue * Number(table.ad_valorem_pct || 0) / 100;
  const grisPct = Number(table.gris_pct || 0);
  const gris = grisPct > 0 ? Math.max(cargoValue * grisPct / 100, Number(table.gris_min || 0)) : 0;
  const toll = Math.ceil(taxable / 100) * Number(table.toll_per_100kg || 0);
  const fees = Number(table.pickup_fee || 0) + Number(table.delivery_fee || 0);

  let subtotal = freightWeight + adValorem + gris + toll + fees;
  const minFreight = Number(table.min_freight || 0);
  if (subtotal < minFreight) {
    freightWeight += minFreight - subtotal; // completa o mínimo no frete peso
    subtotal = minFreight;
  }

  const rate = Number(table.icms_rate || 0);
  let total = subtotal;
  let icms = 0;
  if (rate > 0) {
    if (table.icms_included) {
      icms = total * rate / 100;
    } else {
      total = subtotal / (1 - rate / 100);
      icms = total - subtotal;
    }
  }

  return {
    table_id: tableId,
    range_id: Number(range.range_id),
    calc_mode: table.calc_mode,
    taxable_weight: Math.round(taxable * 1000) / 1000,
    freight_weight: round2(freightWeight),
    ad_valorem: round2(adValorem),
    gris: round2(gris),
    toll: round2(toll),
    fees: round2(fees),
    icms_rate: rate,
    icms_amount: round2(icms),
    total: round2(total),
    lead_time_days: range.lead_time_days,
  };
}

/** Componentes do CT-e a partir do cálculo */
export function calcToComponents(calc) {
  const rows = [
    ['FRETE PESO', calc.freight_weight],
    ['FRETE VALOR (AD VALOREM)', calc.ad_valorem],
    ['GRIS', calc.gris],
    ['PEDAGIO', calc.toll],
    ['TAXAS (COLETA/ENTREGA)', calc.fees],
  ];
  const sum = rows.reduce((acc, [, v]) => acc + Number(v || 0), 0);
  if (round2(calc.total - sum) > 0) rows.push(['ICMS (POR DENTRO)', round2(calc.total - sum)]);
  return rows.filter(([, v]) => Number(v) > 0).map(([name, amount]) => ({ name, amount }));
}
