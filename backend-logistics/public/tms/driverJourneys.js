// ╔══════════════════════════════════════════════════════════════════════╗
// ║ driverJourneys.js — Jornada do Motorista (Lei 13.103/2015)          ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Início, fim, refeição, descanso, espera e tempo de direção       ║
// ║ ✅ Horas trabalhadas, hora extra e alertas da lei                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, esc, fmtMinutes, todayIso } from './tmsEngine.js';
import { fVehicle, fDriver, fTrip, fNotes, fDate, fInt, fShow, cVehicle, cDriver } from './tmsCommon.js';

const minutesBetween = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);

mountTmsPage({
  title: 'Jornada do Motorista',
  subtitle: 'Controle de jornada dos motoristas empregados, com os limites da Lei 13.103 (lei do motorista).',
  tabs: [{
    key: 'journeys', label: '⏱️ Jornadas', resource: 'journeys', pk: 'journey_id', newLabel: '➕ Nova jornada',
    intro: 'Limites conferidos: até 2h de hora extra por dia, 11h de descanso entre jornadas, 1h de refeição e 30 min de descanso a cada 5h30 de direção.',
    searchPlaceholder: 'Motorista, placa...',
    filters: [
      { key: 'driver_id', label: 'Motorista', type: 'lookup', lookup: 'drivers' },
      { key: 'period', type: 'daterange', label: 'Data de' },
    ],
    columns: [
      { key: 'journey_date', label: 'Data', fmt: 'date', width: 95 },
      cDriver, cVehicle,
      { key: 'start_at', label: 'Início', fmt: 'datetime', width: 130 },
      { key: 'end_at', label: 'Fim', fmt: 'datetime', width: 130 },
      { key: 'worked_min', label: 'Trabalhado', fmt: 'min', width: 100 },
      { key: 'driving_min', label: 'Direção', fmt: 'min', width: 90 },
      { key: 'overtime_min', label: 'Hora extra', fmt: 'min', width: 90 },
      { key: 'interjourney_rest_min', label: 'Interjornada', fmt: 'min', width: 100 },
      {
        key: 'violations', label: 'Alertas', width: 260,
        render: (r) => (r.violations ? `<span class="tms-warn">⚠️ ${esc(r.violations)}</span>` : (r.end_at ? '<span class="tms-ok">✔ Dentro da lei</span>' : '<span class="tms-sub">em aberto</span>')),
      },
    ],
    form: {
      title: 'Jornada', width: 13,
      defaults: () => ({ journey_date: todayIso(), meal_break_min: 60, rest_break_min: 0, waiting_min: 0 }),
      sections: [
        {
          title: 'Motorista',
          fields: [fDriver({ required: true }), fVehicle(), fTrip(), fDate('journey_date', 'Data')],
        },
        {
          title: 'Horários',
          fields: [
            { key: 'start_at', label: 'Início da jornada', type: 'datetime', required: true, w: 17 },
            { key: 'end_at', label: 'Fim da jornada', type: 'datetime', w: 17 },
            fInt('meal_break_min', 'Refeição (min)', { w: 10 }), fInt('rest_break_min', 'Descansos (min)', { w: 10 }),
            fInt('waiting_min', 'Espera (min)', { w: 10 }), fInt('driving_min', 'Direção (min)', { w: 10 }),
          ],
        },
        {
          title: 'Resumo',
          fields: [fShow('w_total', 'Trabalhado'), fShow('w_extra', 'Hora extra'), fShow('w_alert', 'Alertas', { w: 30 })],
        },
        { fields: [fNotes()] },
      ],
      compute(v, form) {
        const total = minutesBetween(v.start_at, v.end_at);
        if (total == null || total <= 0) {
          form.set('w_total', '—');
          form.set('w_extra', '—');
          form.set('w_alert', total != null && total <= 0 ? 'O fim deve ser depois do início' : '');
          return;
        }
        const worked = Math.max(0, total - (Number(v.meal_break_min) || 0) - (Number(v.rest_break_min) || 0) - (Number(v.waiting_min) || 0));
        const extra = Math.max(0, worked - 480);
        const alerts = [];
        if (extra > 120) alerts.push('hora extra acima de 2h');
        if (worked > 360 && (Number(v.meal_break_min) || 0) < 60) alerts.push('refeição menor que 1h');
        if ((Number(v.driving_min) || 0) > 330 && (Number(v.rest_break_min) || 0) < 30) alerts.push('falta descanso de 30 min');
        form.set('w_total', fmtMinutes(worked));
        form.set('w_extra', fmtMinutes(extra));
        form.set('w_alert', alerts.length ? `⚠️ ${alerts.join(', ')}` : '✔ Dentro da lei');
      },
    },
  }],
});
