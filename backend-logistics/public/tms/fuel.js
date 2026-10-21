// ╔══════════════════════════════════════════════════════════════════════╗
// ║ fuel.js — Abastecimentos                                            ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Litros, preço, total, posto, km do hodômetro                     ║
// ║ ✅ Consumo (km/l) e custo por km calculados pelo abastecimento      ║
// ║    anterior do mesmo veículo                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, esc, fmtMoney, fmtNum, todayIso } from './tmsEngine.js';
import { fVehicle, fDriver, fTrip, fNotes, fNum, fInt, fDate, fShow, cVehicle, cDriver } from './tmsCommon.js';

const FUEL_TYPES = [
  { value: 'DIESEL_S10', label: 'Diesel S10' }, { value: 'DIESEL_S500', label: 'Diesel S500' }, { value: 'ARLA32', label: 'Arla 32' },
  { value: 'GASOLINA', label: 'Gasolina' }, { value: 'ETANOL', label: 'Etanol' }, { value: 'GNV', label: 'GNV' },
];
const FUEL_LABEL = Object.fromEntries(FUEL_TYPES.map((f) => [f.value, f.label]));

mountTmsPage({
  title: 'Abastecimentos',
  subtitle: 'Registre os abastecimentos da frota e acompanhe o consumo (km/l) e o custo por km de cada veículo.',
  tabs: [{
    key: 'fuel', label: '⛽ Abastecimentos', resource: 'fuel', pk: 'fuel_entry_id', newLabel: '➕ Novo abastecimento',
    intro: 'O consumo é calculado com o km do abastecimento anterior do mesmo veículo. Informe sempre o km do hodômetro.',
    searchPlaceholder: 'Placa, posto, nota...',
    filters: [
      { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
      { key: 'fuel_type', label: 'Combustível', options: FUEL_TYPES },
      { key: 'period', type: 'daterange', label: 'Data de' },
    ],
    columns: [
      { key: 'fuel_date', label: 'Data', fmt: 'date', width: 95 },
      cVehicle, cDriver,
      { key: 'fuel_type', label: 'Combustível', width: 110, render: (r) => esc(FUEL_LABEL[r.fuel_type]) },
      { key: 'odometer_km', label: 'Km', fmt: 'int', width: 100 },
      { key: 'liters', label: 'Litros', fmt: 'num', digits: 2, width: 90 },
      { key: 'unit_price', label: 'R$/litro', fmt: 'num', digits: 3, width: 90 },
      { key: 'total_amount', label: 'Total', fmt: 'money', width: 110 },
      { key: 'km_driven', label: 'Km rodados', fmt: 'int', width: 100 },
      { key: 'km_per_liter', label: 'km/l', fmt: 'num', digits: 2, width: 80 },
      { key: 'cost_per_km', label: 'R$/km', fmt: 'num', digits: 3, width: 80 },
      { key: 'station_name', label: 'Posto', width: 160 },
    ],
    summary: (rows) => {
      const liters = rows.reduce((a, r) => a + Number(r.liters || 0), 0);
      const total = rows.reduce((a, r) => a + Number(r.total_amount || 0), 0);
      return `Na página: <strong>${esc(fmtNum(liters, 1))} litros</strong> · <strong>${esc(fmtMoney(total))}</strong>`;
    },
    form: {
      title: 'Abastecimento', width: 13,
      defaults: () => ({ fuel_date: todayIso(), fuel_type: 'DIESEL_S10', full_tank: true }),
      sections: [
        {
          title: 'Veículo',
          fields: [fVehicle({ required: true }), fDriver(), fTrip(), fDate('fuel_date', 'Data'), fInt('odometer_km', 'Km do hodômetro', { w: 12 })],
        },
        {
          title: 'Abastecimento',
          fields: [
            { key: 'fuel_type', label: 'Combustível', type: 'select', noEmpty: true, options: FUEL_TYPES, w: 12 },
            fNum('liters', 'Litros', { required: true }), fNum('unit_price', 'Preço por litro', { step: 0.0001 }),
            { key: 'total_amount', label: 'Total (vazio = litros x preço)', type: 'money', w: 15, min: 0 },
            { key: 'full_tank', label: 'Tanque cheio', type: 'bool', default: true, w: 10 },
            { key: 'station_name', label: 'Posto', w: 20 }, { key: 'invoice_number', label: 'Nota / cupom', w: 12 },
            fShow('calc_total', 'Total calculado'),
          ],
        },
        { fields: [fNotes()] },
      ],
      compute(v, form) {
        const total = Number(v.total_amount) || (Number(v.liters) || 0) * (Number(v.unit_price) || 0);
        form.set('calc_total', fmtMoney(total));
      },
    },
  }],
});
