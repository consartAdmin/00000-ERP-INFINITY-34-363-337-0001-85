// ╔══════════════════════════════════════════════════════════════════════╗
// ║ freightTables.js — Tabelas de Frete                                 ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Cálculo por PESO (R$/kg), KM (R$/km) ou valor FIXO               ║
// ║ ✅ Faixas por UF/cidade de origem e destino e por faixa de peso     ║
// ║ ✅ Ad valorem, GRIS (com mínimo), pedágio por 100 kg, taxas, ICMS   ║
// ║ ✅ Simulador de frete                                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, ask, notifyInfo, esc, fmtMoney, fmtNum, fmtDate } from './tmsEngine.js';
import { fNotes, fUf, fCity, fMoney, fNum, fDate, fCustomer, hidden } from './tmsCommon.js';

const CALC_MODES = [
  { value: 'PESO', label: 'Por peso (R$/kg)' }, { value: 'KM', label: 'Por distância (R$/km)' }, { value: 'FIXO', label: 'Valor fixo' },
];
const CALC_LABEL = Object.fromEntries(CALC_MODES.map((m) => [m.value, m.label]));

async function simulate() {
  const v = await ask({
    title: '🧮 Simular frete',
    fields: [
      { key: 'table_id', label: 'Tabela de frete', type: 'lookup', lookup: 'freightTables', required: true, w: 40 },
      fCity('origin_city', 'Cidade de origem'), fUf('origin_state', 'UF origem', { w: 8 }),
      fCity('destination_city', 'Cidade de destino'), fUf('destination_state', 'UF destino', { w: 8 }),
      fNum('weight_kg', 'Peso (kg)', { w: 10 }), fNum('cubage_m3', 'Cubagem (m³)', { w: 10 }),
      fMoney('cargo_value', 'Valor da carga', { w: 10 }), fNum('distance_km', 'Distância (km)', { w: 10 }),
    ],
    confirmLabel: '🧮 Calcular',
  });
  if (!v) return;
  const c = await api('/quotes/calc', { method: 'POST', body: v });
  const lines = [
    `Peso taxado: ${fmtNum(c.taxable_weight, 3)} kg`,
    `Frete peso: ${fmtMoney(c.freight_weight)}`,
    `Ad valorem: ${fmtMoney(c.ad_valorem)}`,
    `GRIS: ${fmtMoney(c.gris)}`,
    `Pedágio: ${fmtMoney(c.toll)}`,
    `Taxas: ${fmtMoney(c.fees)}`,
    `ICMS (${fmtNum(c.icms_rate)}%): ${fmtMoney(c.icms_amount)}`,
    `TOTAL: ${fmtMoney(c.total)}${c.lead_time_days ? ` · prazo ${c.lead_time_days} dia(s)` : ''}`,
  ];
  notifyInfo('Frete simulado', lines);
}

mountTmsPage({
  title: 'Tabelas de Frete',
  subtitle: 'Preços por faixa de peso, distância ou valor fixo, com GRIS, ad valorem, pedágio e ICMS.',
  tabs: [{
    key: 'tables', label: '💲 Tabelas', resource: 'freightTables', pk: 'table_id', newLabel: '➕ Nova tabela',
    toolbar: [{ label: '🧮 Simular frete', run: simulate }],
    filters: [
      { key: 'calc_mode', label: 'Cálculo', options: CALC_MODES },
      { key: 'is_active', label: 'Ativa', options: [{ value: 'true', label: 'Ativas' }, { value: 'false', label: 'Inativas' }] },
    ],
    columns: [
      { key: 'name', label: 'Tabela', width: 220 },
      { key: 'customer_name', label: 'Cliente', width: 220, render: (r) => esc(r.customer_name || 'Geral (todos)') },
      { key: 'calc_mode', label: 'Cálculo', width: 150, render: (r) => esc(CALC_LABEL[r.calc_mode]) },
      { key: 'valid', label: 'Vigência', width: 170, render: (r) => esc([fmtDate(r.valid_from), fmtDate(r.valid_until)].filter(Boolean).join(' a ') || 'Sem prazo') },
      { key: 'min_freight', label: 'Frete mínimo', fmt: 'money', width: 110 },
      { key: 'range_count', label: 'Faixas', fmt: 'int', width: 70 },
      { key: 'is_active', label: 'Ativa', fmt: 'bool', width: 70 },
    ],
    form: {
      title: 'Tabela de frete', width: 15,
      defaults: () => ({ calc_mode: 'PESO', cubage_factor: 300, is_active: true, ranges: [{}] }),
      sections: [
        {
          title: 'Tabela',
          fields: [
            { key: 'name', label: 'Nome da tabela', required: true, w: 25 },
            hidden('customer_id'),
            fCustomer('customer', 'Cliente (vazio = tabela geral)', { idField: 'customer_id', fill: {} }),
            { key: 'calc_mode', label: 'Cálculo', type: 'select', noEmpty: true, options: CALC_MODES, w: 15 },
            fDate('valid_from', 'Vigência de'), fDate('valid_until', 'Vigência até'),
            { key: 'is_active', label: 'Ativa', type: 'bool', default: true, w: 8 },
          ],
        },
        {
          title: 'Adicionais',
          fields: [
            fNum('cubage_factor', 'Fator de cubagem (kg/m³)', { step: 1 }),
            fNum('ad_valorem_pct', 'Ad valorem (%)', { step: 0.001 }),
            fNum('gris_pct', 'GRIS (%)', { step: 0.001 }), fMoney('gris_min', 'GRIS mínimo (R$)'),
            fMoney('toll_per_100kg', 'Pedágio por 100 kg (R$)'),
            fMoney('pickup_fee', 'Taxa de coleta'), fMoney('delivery_fee', 'Taxa de entrega'),
            fMoney('min_freight', 'Frete mínimo'),
            fNum('icms_rate', 'ICMS (%)', { step: 0.01 }),
            { key: 'icms_included', label: 'ICMS já incluso no preço', type: 'bool', default: false, w: 12 },
          ],
        },
        { fields: [fNotes()] },
      ],
      children: [{
        key: 'ranges', title: '📐 Faixas de preço (deixe UF/cidade vazia para valer para todas)', addLabel: 'Adicionar faixa',
        columns: [
          { key: 'origin_state', label: 'UF orig.', type: 'uf', width: 80 },
          { key: 'origin_city', label: 'Cidade origem', width: 150 },
          { key: 'destination_state', label: 'UF dest.', type: 'uf', width: 80 },
          { key: 'destination_city', label: 'Cidade destino', width: 150 },
          { key: 'weight_from', label: 'Peso de (kg)', type: 'number', step: 0.001, width: 100 },
          { key: 'weight_to', label: 'Peso até (kg)', type: 'number', step: 0.001, width: 100 },
          { key: 'price_per_kg', label: 'R$/kg', type: 'number', step: 0.0001, width: 90 },
          { key: 'fixed_price', label: 'Valor fixo', type: 'money', width: 100 },
          { key: 'price_per_km', label: 'R$/km', type: 'number', step: 0.0001, width: 90 },
          { key: 'lead_time_days', label: 'Prazo (dias)', type: 'int', width: 80 },
        ],
      }],
    },
  }],
});
