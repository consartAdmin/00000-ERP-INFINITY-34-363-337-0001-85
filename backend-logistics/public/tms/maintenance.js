// ╔══════════════════════════════════════════════════════════════════════╗
// ║ maintenance.js — Manutenção da Frota                                ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Ordens de serviço (preventiva, corretiva, socorro) com custos    ║
// ║ ✅ Planos preventivos por km e/ou dias, com aviso de vencimento     ║
// ║ ✅ OS concluída atualiza o último km / data do plano                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, notifyOk, esc, fmtDate, fmtMoney, fmtNum, todayIso } from './tmsEngine.js';
import { fVehicle, fTrip, fNotes, fMoney, fInt, fDate, fShow, cVehicle } from './tmsCommon.js';

const WO_TYPES = [
  { value: 'PREVENTIVA', label: 'Preventiva' }, { value: 'CORRETIVA', label: 'Corretiva' },
  { value: 'PREDITIVA', label: 'Preditiva' }, { value: 'SOCORRO', label: 'Socorro' },
];
const WO_TYPE_LABEL = Object.fromEntries(WO_TYPES.map((s) => [s.value, s.label]));
const WO_STATUS = [
  { value: 'ABERTA', label: 'Aberta' }, { value: 'EM_EXECUCAO', label: 'Em execução' },
  { value: 'CONCLUIDA', label: 'Concluída' }, { value: 'CANCELADA', label: 'Cancelada' },
];
const WO_LABEL = Object.fromEntries(WO_STATUS.map((s) => [s.value, s.label]));
const PLAN_LABEL = { EM_DIA: 'Em dia', PROXIMO: 'Próximo', VENCIDO: 'Vencido' };

const setStatus = (status, msg) => async (r, page) => {
  const body = { status };
  if (status === 'CONCLUIDA' && !r.close_date) body.close_date = todayIso();
  await api(`/workOrders/${r.work_order_id}`, { method: 'PUT', body });
  notifyOk(msg);
  await page.reloadAll();
};

mountTmsPage({
  title: 'Manutenção da Frota',
  subtitle: 'Ordens de serviço com custo de peças e mão de obra, e planos de manutenção preventiva por km ou por tempo.',
  tabs: [
    {
      key: 'orders', label: '🔧 Ordens de serviço', resource: 'workOrders', pk: 'work_order_id', newLabel: '➕ Nova OS', actionsWidth: 260,
      searchPlaceholder: 'Nº, placa, oficina, descrição...',
      filters: [
        { key: 'status', label: 'Situação', options: WO_STATUS },
        { key: 'wo_type', label: 'Tipo', options: WO_TYPES },
        { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
        { key: 'period', type: 'daterange', label: 'Abertura de' },
      ],
      columns: [
        { key: 'work_order_id', label: 'OS', width: 60 },
        { key: 'open_date', label: 'Abertura', fmt: 'date', width: 95 },
        cVehicle,
        { key: 'wo_type', label: 'Tipo', width: 100, render: (r) => esc(WO_TYPE_LABEL[r.wo_type]) },
        { key: 'description', label: 'Serviço', width: 260, render: (r) => `${esc(r.description)}${r.plan_service ? `<span class="tms-sub">Plano: ${esc(r.plan_service)}</span>` : ''}` },
        { key: 'workshop_name', label: 'Oficina', width: 160 },
        { key: 'odometer_km', label: 'Km', fmt: 'int', width: 90 },
        { key: 'total_cost', label: 'Custo', fmt: 'money', width: 110 },
        { key: 'status', label: 'Situação', fmt: 'badge', labels: WO_LABEL, width: 110 },
      ],
      canEdit: (r) => ['ABERTA', 'EM_EXECUCAO'].includes(r.status),
      canDelete: (r) => ['ABERTA', 'CANCELADA'].includes(r.status),
      summary: (rows) => `Custo na página: <strong>${esc(fmtMoney(rows.filter((r) => r.status !== 'CANCELADA').reduce((a, r) => a + Number(r.total_cost || 0), 0)))}</strong>`,
      actions: [
        { label: '▶️ Iniciar', when: (r) => r.status === 'ABERTA', run: setStatus('EM_EXECUCAO', 'OS em execução.') },
        { label: '✅ Concluir', cls: 'btn-confirm', when: (r) => ['ABERTA', 'EM_EXECUCAO'].includes(r.status), run: setStatus('CONCLUIDA', 'OS concluída.') },
        { label: '⛔ Cancelar', cls: 'btn-cancel', when: (r) => ['ABERTA', 'EM_EXECUCAO'].includes(r.status), run: setStatus('CANCELADA', 'OS cancelada.') },
      ],
      form: {
        title: 'Ordem de serviço', width: 13,
        defaults: () => ({ open_date: todayIso(), wo_type: 'CORRETIVA', status: 'ABERTA' }),
        sections: [
          {
            title: 'Veículo e serviço',
            fields: [
              fVehicle({ required: true }),
              { key: 'maintenance_plan_id', label: 'Plano preventivo', type: 'lookup', lookup: 'maintenancePlans', w: 25 },
              { key: 'wo_type', label: 'Tipo', type: 'select', noEmpty: true, options: WO_TYPES, w: 12 },
              { key: 'status', label: 'Situação', type: 'select', noEmpty: true, options: WO_STATUS, w: 12 },
              fDate('open_date', 'Abertura'), fDate('close_date', 'Conclusão'), fInt('odometer_km', 'Km do veículo', { w: 12 }),
              { key: 'description', label: 'Descrição do serviço', type: 'textarea', required: true, rows: 3, w: 40 },
            ],
          },
          {
            title: 'Oficina e custos',
            fields: [
              { key: 'workshop_name', label: 'Oficina', w: 20 }, { key: 'invoice_number', label: 'Nota fiscal', w: 12 },
              fMoney('parts_cost', 'Peças'), fMoney('labor_cost', 'Mão de obra'),
              fShow('total_cost', 'Total', { value: (r) => fmtMoney(r.total_cost) }),
              fTrip({ label: 'Rota (se aconteceu em viagem)' }),
            ],
          },
          { fields: [fNotes()] },
        ],
        compute(v, form) {
          form.set('total_cost', fmtMoney((Number(v.parts_cost) || 0) + (Number(v.labor_cost) || 0)));
        },
      },
    },
    {
      key: 'plans', label: '📅 Planos preventivos', resource: 'maintenancePlans', pk: 'maintenance_plan_id', newLabel: '➕ Novo plano',
      intro: 'O km atual vem do maior km registrado nas rotas, abastecimentos e ordens de serviço do veículo.',
      searchPlaceholder: 'Serviço, placa...',
      filters: [
        { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
        { key: 'is_active', label: 'Ativo', options: [{ value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }] },
      ],
      columns: [
        cVehicle,
        { key: 'service_name', label: 'Serviço', width: 220 },
        { key: 'interval', label: 'A cada', width: 150, render: (r) => esc([r.interval_km ? `${fmtNum(r.interval_km, 0)} km` : '', r.interval_days ? `${r.interval_days} dias` : ''].filter(Boolean).join(' ou ')) },
        { key: 'last', label: 'Última', width: 150, render: (r) => esc([r.last_km != null ? `${fmtNum(r.last_km, 0)} km` : '', fmtDate(r.last_date)].filter(Boolean).join(' · ')) },
        { key: 'current_km', label: 'Km atual', fmt: 'int', width: 100 },
        { key: 'next', label: 'Próxima', width: 150, render: (r) => esc([r.next_km != null ? `${fmtNum(r.next_km, 0)} km` : '', fmtDate(r.next_date)].filter(Boolean).join(' · ')) },
        { key: 'plan_status', label: 'Situação', fmt: 'badge', labels: PLAN_LABEL, width: 100 },
        { key: 'is_active', label: 'Ativo', fmt: 'bool', width: 70 },
      ],
      actions: [{
        label: '🔧 Abrir OS', cls: 'btn-new', when: (r) => r.is_active,
        run: (r, page) => {
          const form = page.tab('orders').form;
          return form.open({
            ...form.cfg.defaults(), wo_type: 'PREVENTIVA', vehicle_id: r.vehicle_id,
            maintenance_plan_id: r.maintenance_plan_id, description: r.service_name, odometer_km: r.current_km,
          });
        },
      }],
      form: {
        title: 'Plano preventivo', width: 11,
        defaults: () => ({ is_active: true }),
        sections: [{
          fields: [
            fVehicle({ required: true }), { key: 'service_name', label: 'Serviço', required: true, w: 19, placeholder: 'Troca de óleo' },
            fInt('interval_km', 'A cada (km)', { w: 12 }), fInt('interval_days', 'A cada (dias)', { w: 12 }),
            { key: 'is_active', label: 'Ativo', type: 'bool', default: true, w: 12 },
            fInt('last_km', 'Última vez (km)', { w: 12 }), fDate('last_date', 'Última vez (data)'),
            fNotes(),
          ],
        }],
      },
    },
  ],
});
