// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tires.js — Controle de Pneus                                        ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Cadastro por nº de fogo, com km rodado e recapagens              ║
// ║ ✅ Montagem, rodízio, desmontagem, recapagem, inspeção e sucata     ║
// ║ ✅ Cada movimento atualiza a situação e o km do pneu                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, ask, notifyOk, esc, fmtNum, todayIso } from './tmsEngine.js';
import { fVehicle, fNotes, fMoney, fNum, fInt, fDate, fShow, cVehicle } from './tmsCommon.js';

const TIRE_STATUS = [
  { value: 'ESTOQUE', label: 'Estoque' }, { value: 'EM_USO', label: 'Em uso' },
  { value: 'RECAPAGEM', label: 'Na recapagem' }, { value: 'SUCATA', label: 'Sucata' },
];
const TIRE_LABEL = Object.fromEntries(TIRE_STATUS.map((s) => [s.value, s.label]));
const MOVES = [
  { value: 'MONTAGEM', label: 'Montagem' }, { value: 'RODIZIO', label: 'Rodízio' }, { value: 'DESMONTAGEM', label: 'Desmontagem' },
  { value: 'RECAPAGEM', label: 'Envio p/ recapagem' }, { value: 'RETORNO_RECAPAGEM', label: 'Retorno da recapagem' },
  { value: 'INSPECAO', label: 'Inspeção' }, { value: 'SUCATA', label: 'Sucata' },
];
const MOVE_LABEL = Object.fromEntries(MOVES.map((m) => [m.value, m.label]));
const POSITION_HINT = 'Ex.: DE, DD, TE1, TD1, ESTEPE';

/** Pergunta os dados do movimento e grava (o servidor atualiza o pneu) */
const move = (type) => async (tire, page) => {
  const needsVehicle = ['MONTAGEM', 'RODIZIO'].includes(type);
  const fields = [fDate('movement_date', 'Data', { value: todayIso(), w: 19 })];
  if (needsVehicle) {
    fields.push(fVehicle({ required: true, value: tire.vehicle_id, w: 19 }));
    fields.push({ key: 'position', label: 'Posição', required: true, placeholder: POSITION_HINT, value: type === 'RODIZIO' ? '' : tire.position, w: 19 });
  }
  if (type !== 'RETORNO_RECAPAGEM') fields.push(fInt('odometer_km', 'Km do veículo', { value: tire.vehicle_km, w: 19 }));
  fields.push(fNum('tread_depth_mm', 'Sulco (mm)', { step: 0.1, value: tire.tread_depth_mm, w: 19 }));
  if (['RECAPAGEM', 'RETORNO_RECAPAGEM'].includes(type)) fields.push(fMoney('cost', 'Custo', { w: 19 }));
  fields.push(fNotes({ w: 40 }));
  const v = await ask({ title: `🛞 ${MOVE_LABEL[type]} · pneu ${tire.fire_number}`, fields, confirmLabel: '💾 Registrar' });
  if (!v) return;
  if (type === 'SUCATA' && !confirm('Mandar o pneu para sucata? Ele não poderá mais ser usado.')) return;
  await api('/tireMovements', { method: 'POST', body: { ...v, tire_id: tire.tire_id, movement_type: type } });
  notifyOk(`${MOVE_LABEL[type]} registrada.`);
  await page.reloadAll();
};

mountTmsPage({
  title: 'Controle de Pneus',
  subtitle: 'Acompanhe cada pneu pelo número de fogo: onde está montado, quanto rodou, sulco e recapagens.',
  tabs: [
    {
      key: 'tires', label: '🛞 Pneus', resource: 'tires', pk: 'tire_id', newLabel: '➕ Novo pneu', actionsWidth: 380,
      searchPlaceholder: 'Nº de fogo, marca, medida, placa...',
      filters: [
        { key: 'status', label: 'Situação', options: TIRE_STATUS },
        { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
      ],
      columns: [
        { key: 'fire_number', label: 'Nº de fogo', width: 100 },
        { key: 'tire', label: 'Pneu', width: 200, render: (r) => `${esc([r.brand, r.model].filter(Boolean).join(' '))}<span class="tms-sub">${esc(r.size || '')}</span>` },
        cVehicle,
        { key: 'position', label: 'Posição', width: 80 },
        {
          key: 'km', label: 'Km rodado', width: 110, fmt: 'int',
          render: (r) => {
            const running = r.status === 'EM_USO' && r.installed_km != null && r.vehicle_km != null ? Math.max(0, r.vehicle_km - r.installed_km) : 0;
            return esc(fmtNum((Number(r.total_km) || 0) + running, 0));
          },
        },
        { key: 'retread_count', label: 'Recapagens', fmt: 'int', width: 90 },
        { key: 'tread_depth_mm', label: 'Sulco (mm)', fmt: 'num', digits: 1, width: 90 },
        { key: 'status', label: 'Situação', fmt: 'badge', labels: TIRE_LABEL, width: 110 },
      ],
      canEdit: (r) => r.status !== 'SUCATA',
      canDelete: (r) => r.status === 'ESTOQUE',
      rowClass: (r) => (r.status === 'SUCATA' ? 'is-muted' : ''),
      actions: [
        { label: '🔩 Montar', cls: 'btn-confirm', when: (r) => r.status === 'ESTOQUE', run: move('MONTAGEM') },
        { label: '🔄 Rodízio', when: (r) => r.status === 'EM_USO', run: move('RODIZIO') },
        { label: '⬇️ Desmontar', when: (r) => r.status === 'EM_USO', run: move('DESMONTAGEM') },
        { label: '🔍 Inspeção', when: (r) => ['ESTOQUE', 'EM_USO'].includes(r.status), run: move('INSPECAO') },
        { label: '♻️ Recapar', when: (r) => ['ESTOQUE', 'EM_USO'].includes(r.status), run: move('RECAPAGEM') },
        { label: '↩️ Retorno', cls: 'btn-confirm', when: (r) => r.status === 'RECAPAGEM', run: move('RETORNO_RECAPAGEM') },
        { label: '🗑️ Sucata', cls: 'btn-cancel', when: (r) => r.status !== 'SUCATA', run: move('SUCATA') },
      ],
      form: {
        title: 'Pneu', width: 12,
        defaults: () => ({ status: 'ESTOQUE', purchase_date: todayIso(), total_km: 0, retread_count: 0 }),
        sections: [
          {
            title: 'Pneu',
            fields: [
              { key: 'fire_number', label: 'Nº de fogo', required: true, lockOnEdit: true, w: 12 },
              { key: 'brand', label: 'Marca', w: 14 }, { key: 'model', label: 'Modelo', w: 14 },
              { key: 'size', label: 'Medida', w: 12, placeholder: '295/80 R22.5' },
              fNum('tread_depth_mm', 'Sulco (mm)', { step: 0.1 }),
            ],
          },
          {
            title: 'Compra',
            fields: [
              fDate('purchase_date', 'Data da compra'), fMoney('purchase_cost', 'Valor'),
              { key: 'supplier_name', label: 'Fornecedor', w: 20 },
              fInt('total_km', 'Km já rodado (pneu usado)', { w: 14, lockOnEdit: true }),
              fInt('retread_count', 'Recapagens', { w: 10, lockOnEdit: true }),
            ],
          },
          {
            title: 'Situação (muda pelos movimentos)', when: (r) => !!r.tire_id,
            fields: [
              fShow('status_show', 'Situação', { value: (r) => TIRE_LABEL[r.status] }),
              fShow('vehicle_show', 'Veículo', { value: (r) => r.vehicle_plate || '—' }),
              fShow('position_show', 'Posição', { value: (r) => r.position || '—' }),
              fShow('installed_show', 'Montado no km', { value: (r) => (r.installed_km != null ? fmtNum(r.installed_km, 0) : '—') }),
            ],
          },
          { fields: [fNotes()] },
        ],
      },
    },
    {
      key: 'moves', label: '📜 Movimentações', resource: 'tireMovements', pk: 'tire_movement_id', allowNew: false, allowDelete: false,
      intro: 'Histórico de cada pneu. Para registrar um movimento, use os botões na aba Pneus.',
      searchPlaceholder: 'Nº de fogo, placa...',
      filters: [
        { key: 'tire_id', label: 'Pneu', type: 'lookup', lookup: 'tires' },
        { key: 'movement_type', label: 'Movimento', options: MOVES },
        { key: 'period', type: 'daterange', label: 'Data de' },
      ],
      columns: [
        { key: 'movement_date', label: 'Data', fmt: 'date', width: 95 },
        { key: 'fire_number', label: 'Nº de fogo', width: 100, render: (r) => `${esc(r.fire_number)}<span class="tms-sub">${esc(r.tire_brand || '')}</span>` },
        { key: 'movement_type', label: 'Movimento', width: 160, render: (r) => esc(MOVE_LABEL[r.movement_type]) },
        cVehicle,
        { key: 'position', label: 'Posição', width: 80 },
        { key: 'odometer_km', label: 'Km', fmt: 'int', width: 100 },
        { key: 'tread_depth_mm', label: 'Sulco (mm)', fmt: 'num', digits: 1, width: 90 },
        { key: 'cost', label: 'Custo', fmt: 'money', width: 100 },
        { key: 'notes', label: 'Observações', width: 220 },
      ],
    },
  ],
});
