// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cte.js — CT-e (Conhecimento de Transporte Eletrônico, modelo 57)    ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Digitar, emitir (número + chave de acesso), cancelar             ║
// ║ ✅ Documentos transportados (NF-e) e componentes do frete           ║
// ║ ✅ Averbação do seguro de carga (RCTR-C) + apólices                 ║
// ║ ✅ DACTE simplificado para impressão                                ║
// ║ O envio à SEFAZ entra numa próxima etapa.                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  mountTmsPage, api, ask, notifyOk, esc, fmtDate, fmtMoney, fmtNum, printHtml, formatKey, todayIso,
} from './tmsEngine.js';
import {
  fVehicle, fDriver, fTrip, fNotes, fUf, fCity, fMoney, fNum, fInt, fDate, fShow, fCustomer, hidden,
  place, docNumber, CTE_STATUS, DELIVERY_STATUS, CTE_LABEL, DELIVERY_LABEL,
} from './tmsCommon.js';

const COMPONENT_NAMES = ['FRETE PESO', 'FRETE VALOR (AD VALOREM)', 'GRIS', 'PEDAGIO', 'TAXA DE COLETA',
  'TAXA DE ENTREGA', 'TDE (DIFICULDADE DE ENTREGA)', 'TAXAS (COLETA/ENTREGA)', 'ICMS (POR DENTRO)', 'OUTROS'];

const sumAmount = (rows) => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

async function printDacte(row) {
  const { doc: c, emitter: e } = await api(`/print/cte/${row.cte_id}`);
  printHtml(`DACTE ${c.number ?? ''}`, `
    <h1>DACTE — Documento Auxiliar do Conhecimento de Transporte Eletrônico</h1>
    <p class="warn">Documento sem valor fiscal enquanto o CT-e não for autorizado pela SEFAZ.</p>
    <div class="grid">
      <div class="box"><strong>${esc(e?.razao_social || 'EMITENTE')}</strong><br>CNPJ ${esc(e?.cnpj || '')} · IE ${esc(e?.ie || '')}<br>
        ${esc(e?.endereco || '')} ${esc(e?.numero || '')} ${esc(e?.bairro || '')} · ${esc(e?.uf || '')}</div>
      <div class="box">Modelo 57 · Série ${esc(c.series)} · Nº <strong>${esc(c.number ?? '—')}</strong> · Emissão ${esc(fmtDate(c.issue_date))}<br>
        CFOP ${esc(c.cfop || '')} · ${esc(c.nature)}<br>Situação: <strong>${esc(CTE_LABEL[c.status] || c.status)}</strong><br>
        Chave: <span class="key">${esc(formatKey(c.access_key) || '—')}</span></div>
    </div>
    <h2>Partes</h2>
    <table><tr><th>Remetente</th><th>Destinatário</th><th>Tomador (${esc(c.payer_role)})</th></tr>
      <tr><td>${esc(c.sender_name)}<br>${esc(c.sender_tax_id || '')}<br>${esc(place(c.sender_city, c.sender_state))}</td>
          <td>${esc(c.recipient_name)}<br>${esc(c.recipient_tax_id || '')}<br>${esc(c.recipient_address || '')}<br>${esc(place(c.recipient_city, c.recipient_state))}</td>
          <td>${esc(c.payer_name || '')}<br>${esc(c.payer_tax_id || '')}</td></tr></table>
    <h2>Prestação</h2>
    <table><tr><th>Origem</th><th>Destino</th><th>Produto predominante</th><th class="r">Valor da carga</th><th class="r">Peso (kg)</th><th class="r">Volumes</th></tr>
      <tr><td>${esc(place(c.origin_city, c.origin_state))}</td><td>${esc(place(c.destination_city, c.destination_state))}</td>
        <td>${esc(c.cargo_description || '')}</td><td class="r">${esc(fmtMoney(c.cargo_value))}</td>
        <td class="r">${esc(fmtNum(c.weight_kg, 3))}</td><td class="r">${esc(c.volumes ?? '')}</td></tr></table>
    <h2>Componentes do valor da prestação</h2>
    <table>${(c.components || []).map((x) => `<tr><td>${esc(x.name)}</td><td class="r">${esc(fmtMoney(x.amount))}</td></tr>`).join('')}
      <tr><th>Valor total da prestação</th><th class="r">${esc(fmtMoney(c.freight_total))}</th></tr>
      <tr><td>ICMS ${esc(c.icms_cst || '')} · base ${esc(fmtMoney(c.icms_base))} · ${esc(fmtNum(c.icms_rate))}%</td><td class="r">${esc(fmtMoney(c.icms_amount))}</td></tr></table>
    <h2>Documentos transportados</h2>
    <table><tr><th>Tipo</th><th>Número</th><th>Chave</th><th class="r">Valor</th></tr>
      ${(c.documents || []).map((d) => `<tr><td>${esc(d.doc_type)}</td><td>${esc(d.series || '')}/${esc(d.number || '')}</td>
        <td class="key">${esc(formatKey(d.access_key))}</td><td class="r">${esc(fmtMoney(d.amount))}</td></tr>`).join('')}</table>
    <h2>Seguro</h2>
    <p>${esc(c.policy_insurer || '—')} · Apólice ${esc(c.policy_number || '—')} · Averbação ${esc(c.insurance_number || 'pendente')}</p>
    ${c.notes ? `<h2>Observações</h2><p>${esc(c.notes)}</p>` : ''}`);
}

mountTmsPage({
  title: 'CT-e — Conhecimento de Transporte',
  subtitle: 'Digite, emita e acompanhe os conhecimentos de transporte, com averbação do seguro.',
  notice: '⚠️ Nesta etapa o CT-e é numerado e recebe a chave de acesso no sistema. O envio para a SEFAZ entra numa próxima etapa.',
  tabs: [
    {
      key: 'cte', label: '📄 CT-e', resource: 'cte', pk: 'cte_id', newLabel: '➕ Novo CT-e', actionsWidth: 330,
      searchPlaceholder: 'Nº, chave, remetente, destinatário, cidade, placa...',
      filters: [
        { key: 'status', label: 'Situação', options: CTE_STATUS },
        { key: 'delivery_status', label: 'Entrega', options: DELIVERY_STATUS },
        { key: 'period', type: 'daterange', label: 'Emissão de' },
      ],
      columns: [
        { key: 'number', label: 'Nº', width: 80, render: docNumber },
        { key: 'issue_date', label: 'Emissão', fmt: 'date', width: 95 },
        { key: 'sender_name', label: 'Remetente', width: 200 },
        {
          key: 'recipient_name', label: 'Destinatário', width: 220,
          render: (r) => `${esc(r.recipient_name)}<span class="tms-sub">${esc(place(r.destination_city, r.destination_state))}</span>`,
        },
        { key: 'doc_numbers', label: 'NF-e', width: 110 },
        { key: 'freight_total', label: 'Frete', fmt: 'money', width: 110 },
        { key: 'status', label: 'Situação', fmt: 'badge', labels: CTE_LABEL, width: 140 },
        { key: 'delivery_status', label: 'Entrega', fmt: 'badge', labels: DELIVERY_LABEL, width: 120 },
        { key: 'insurance_status', label: 'Seguro', fmt: 'badge', width: 110 },
      ],
      canEdit: (r) => r.status === 'DIGITADO',
      canDelete: (r) => r.status === 'DIGITADO',
      summary: (rows) => `Frete na página: <strong>${esc(fmtMoney(sumAmount(rows.map((r) => ({ amount: r.status === 'CANCELADO' ? 0 : r.freight_total })))))}</strong>`,
      actions: [
        {
          label: '🚀 Emitir', cls: 'btn-confirm', when: (r) => r.status === 'DIGITADO',
          async run(r, page) {
            if (!confirm(`Emitir o CT-e? Ele recebe número e chave de acesso e não pode mais ser alterado.`)) return;
            const out = await api(`/cte/${r.cte_id}/emit`, { method: 'POST' });
            notifyOk(`CT-e nº ${out.number} emitido.`);
            await page.reloadAll();
          },
        },
        {
          label: '🛡️ Averbar', when: (r) => ['EMITIDO', 'AUTORIZADO'].includes(r.status) && r.insurance_status === 'PENDENTE',
          title: 'Registrar a averbação do seguro de carga',
          async run(r, page) {
            const v = await ask({
              title: `🛡️ Averbação do CT-e ${r.number}`,
              fields: [
                { key: 'policy_id', label: 'Apólice', type: 'lookup', lookup: 'policies', value: r.policy_id, required: true },
                { key: 'insurance_number', label: 'Nº da averbação (devolvido pela averbadora)', required: true, w: 25 },
                { key: 'insurance_protocol', label: 'Protocolo', w: 15 },
                { key: 'status', label: 'Situação', type: 'select', noEmpty: true, w: 20,
                  options: [{ value: 'AVERBADO', label: 'Averbado' }, { value: 'NAO_SE_APLICA', label: 'Não se aplica (seguro do tomador)' }] },
              ],
              confirmLabel: '💾 Registrar',
            });
            if (!v) return;
            await api(`/cte/${r.cte_id}/insure`, { method: 'POST', body: v });
            notifyOk('Averbação registrada.');
            await page.reloadAll();
          },
        },
        { label: '🖨️ DACTE', run: (r) => printDacte(r) },
        {
          label: '❌ Cancelar', cls: 'btn-cancel', when: (r) => ['EMITIDO', 'AUTORIZADO'].includes(r.status),
          async run(r, page) {
            const v = await ask({
              title: `❌ Cancelar CT-e ${r.number}`,
              fields: [{ key: 'reason', label: 'Motivo do cancelamento (mín. 15 letras)', type: 'textarea', required: true }],
              confirmLabel: '❌ Cancelar CT-e',
            });
            if (!v) return;
            await api(`/cte/${r.cte_id}/cancel`, { method: 'POST', body: v });
            notifyOk('CT-e cancelado.');
            await page.reloadAll();
          },
        },
      ],
      form: {
        title: 'CT-e', width: 15,
        editTitle: (r) => `📄 CT-e ${r.number ? `nº ${r.number}` : `(digitado #${r.cte_id})`}`,
        defaults: () => ({ issue_date: todayIso(), series: 1, components: [{ name: 'FRETE PESO', amount: '' }], documents: [{ doc_type: 'NFE' }] }),
        sections: [
          {
            title: 'Dados do CT-e',
            fields: [
              { key: 'cte_type', label: 'Tipo', type: 'select', noEmpty: true, w: 12, options: ['NORMAL', 'COMPLEMENTAR', 'ANULACAO', 'SUBSTITUTO'], default: 'NORMAL' },
              { key: 'service_type', label: 'Serviço', type: 'select', noEmpty: true, w: 15, default: 'NORMAL',
                options: ['NORMAL', 'SUBCONTRATACAO', 'REDESPACHO', 'REDESPACHO_INTERMEDIARIO', 'MULTIMODAL'] },
              fInt('series', 'Série', { w: 6 }),
              fDate('issue_date', 'Emissão'),
              { key: 'cfop', label: 'CFOP', w: 8, max: 4, placeholder: 'auto' },
              { key: 'payer_role', label: 'Tomador do serviço', type: 'select', noEmpty: true, w: 13, default: 'REMETENTE',
                options: ['REMETENTE', 'EXPEDIDOR', 'RECEBEDOR', 'DESTINATARIO', 'OUTROS'] },
              { key: 'policy_id', label: 'Apólice de seguro', type: 'lookup', lookup: 'policies', w: 25 },
            ],
          },
          {
            title: 'Remetente',
            fields: [
              hidden('sender_customer_id'),
              fCustomer('sender', 'Remetente', { required: true }),
              { key: 'sender_tax_id', label: 'CNPJ/CPF', w: 13 },
              fCity('sender_city'), fUf('sender_state'),
            ],
          },
          {
            title: 'Destinatário',
            fields: [
              hidden('recipient_customer_id'),
              fCustomer('recipient', 'Destinatário', { required: true }),
              { key: 'recipient_tax_id', label: 'CNPJ/CPF', w: 13 },
              { key: 'recipient_address', label: 'Endereço', w: 30 },
              fCity('recipient_city'), fUf('recipient_state'),
            ],
          },
          {
            title: 'Tomador (quem paga o frete) — preenchido sozinho quando é o remetente ou o destinatário',
            fields: [
              hidden('payer_customer_id'),
              fCustomer('payer', 'Tomador'),
              { key: 'payer_tax_id', label: 'CNPJ/CPF', w: 13 },
            ],
          },
          {
            title: 'Percurso e carga',
            fields: [
              fCity('origin_city', 'Origem'), fUf('origin_state'),
              fCity('destination_city', 'Destino'), fUf('destination_state'),
              { key: 'cargo_description', label: 'Produto predominante', w: 20 },
              fMoney('cargo_value', 'Valor da carga', { placeholder: 'soma das NF' }),
              fNum('weight_kg', 'Peso (kg)', { placeholder: 'soma das NF' }),
              fInt('volumes', 'Volumes'),
              fNum('cubage_m3', 'Cubagem (m³)'),
            ],
          },
          {
            title: 'Operação e impostos',
            fields: [
              fVehicle(), fDriver(), fTrip(),
              { key: 'icms_cst', label: 'CST ICMS', w: 7, max: 3, placeholder: '00' },
              fNum('icms_rate', 'Alíquota ICMS %', { step: 0.01 }),
              fShow('freight_total', 'Valor do frete', { value: (r) => fmtMoney(r.freight_total) }),
              fShow('icms_amount', 'Valor ICMS', { value: (r) => fmtMoney(r.icms_amount) }),
            ],
          },
          {
            title: 'Situação',
            when: (r) => !!r.cte_id,
            fields: [
              fShow('status_show', 'Situação', { value: (r) => CTE_LABEL[r.status] || r.status }),
              fShow('access_key', 'Chave de acesso', { w: 30, value: (r) => formatKey(r.access_key) }),
              fShow('insurance_show', 'Averbação', { w: 20, value: (r) => (r.insurance_number ? `${r.insurance_number} (${r.insurance_status})` : r.insurance_status) }),
              fShow('delivery_show', 'Entrega', { value: (r) => DELIVERY_LABEL[r.delivery_status] || r.delivery_status }),
              fShow('cancel_reason', 'Motivo do cancelamento', { w: 40 }),
            ],
          },
          { fields: [fNotes()] },
        ],
        children: [
          {
            key: 'documents', title: '🧾 Documentos transportados (NF-e)', addLabel: 'Adicionar NF',
            newRow: () => ({ doc_type: 'NFE' }),
            columns: [
              { key: 'doc_type', label: 'Tipo', type: 'select', noEmpty: true, options: ['NFE', 'NF', 'OUTROS'], width: 90 },
              { key: 'access_key', label: 'Chave NF-e (44 dígitos)', width: 330 },
              { key: 'series', label: 'Série', width: 60 },
              { key: 'number', label: 'Número', width: 90 },
              { key: 'issue_date', label: 'Emissão', type: 'date', width: 130 },
              { key: 'amount', label: 'Valor', type: 'money', width: 110 },
              { key: 'weight_kg', label: 'Peso (kg)', type: 'number', step: 0.001, width: 100 },
              { key: 'volumes', label: 'Vol.', type: 'int', width: 70 },
            ],
            footer: (rows) => `NF: <strong>${rows.length}</strong> · Valor: <strong>${esc(fmtMoney(sumAmount(rows)))}</strong>`,
          },
          {
            key: 'components', title: '💲 Componentes do frete', addLabel: 'Adicionar componente',
            newRow: () => ({ name: 'OUTROS' }),
            columns: [
              { key: 'name', label: 'Componente', type: 'select', noEmpty: true, options: COMPONENT_NAMES.map((n) => ({ value: n, label: n })), width: 300 },
              { key: 'amount', label: 'Valor (R$)', type: 'money', width: 140 },
            ],
            footer: (rows) => `Total da prestação: <strong>${esc(fmtMoney(sumAmount(rows)))}</strong>`,
            toolbar: [
              {
                label: '🧮 Calcular pela tabela de frete',
                async run(form) {
                  const v = form.values();
                  const t = await ask({
                    title: '🧮 Calcular frete',
                    fields: [{ key: 'table_id', label: 'Tabela de frete', type: 'lookup', lookup: 'freightTables', required: true },
                      fNum('distance_km', 'Distância (km) — só para tabela por km', { w: 25 })],
                  });
                  if (!t) return;
                  const docs = v.documents || [];
                  const calc = await api('/quotes/calc', {
                    method: 'POST',
                    body: {
                      ...t,
                      origin_state: v.origin_state || v.sender_state, origin_city: v.origin_city || v.sender_city,
                      destination_state: v.destination_state || v.recipient_state, destination_city: v.destination_city || v.recipient_city,
                      weight_kg: v.weight_kg || docs.reduce((a, d) => a + (Number(d.weight_kg) || 0), 0),
                      cargo_value: v.cargo_value || docs.reduce((a, d) => a + (Number(d.amount) || 0), 0),
                      cubage_m3: v.cubage_m3,
                    },
                  });
                  const rows = [
                    ['FRETE PESO', calc.freight_weight], ['FRETE VALOR (AD VALOREM)', calc.ad_valorem], ['GRIS', calc.gris],
                    ['PEDAGIO', calc.toll], ['TAXAS (COLETA/ENTREGA)', calc.fees],
                  ].filter(([, a]) => Number(a) > 0).map(([name, amount]) => ({ name, amount }));
                  const diff = Math.round((calc.total - sumAmount(rows)) * 100) / 100;
                  if (diff > 0) rows.push({ name: 'ICMS (POR DENTRO)', amount: diff });
                  form.childRows.components = [];
                  form.addChildRows('components', rows);
                  form.set('icms_rate', calc.icms_rate || '');
                  notifyOk(`Frete calculado: ${fmtMoney(calc.total)} (peso taxado ${fmtNum(calc.taxable_weight, 3)} kg).`);
                },
              },
            ],
          },
        ],
        compute(values, form) {
          form.set('freight_total', fmtMoney(sumAmount(values.components || [])));
        },
      },
    },
    {
      key: 'policies', label: '🛡️ Apólices de seguro', resource: 'policies', pk: 'policy_id', newLabel: '➕ Nova apólice',
      intro: 'Apólices usadas na averbação do seguro de carga (RCTR-C obrigatório; RC-DC opcional).',
      filters: [{ key: 'is_active', label: 'Ativa', options: [{ value: 'true', label: 'Ativas' }, { value: 'false', label: 'Inativas' }] }],
      columns: [
        { key: 'insurer_name', label: 'Seguradora', width: 220 },
        { key: 'policy_number', label: 'Apólice', width: 140 },
        { key: 'coverage', label: 'Cobertura', width: 90 },
        { key: 'responsible', label: 'Responsável', width: 110 },
        { key: 'endorser', label: 'Averbadora', width: 120 },
        { key: 'valid_until', label: 'Vigência até', fmt: 'date', width: 110 },
        { key: 'is_active', label: 'Ativa', fmt: 'bool', width: 70 },
      ],
      form: {
        title: 'Apólice', width: 10,
        sections: [{
          fields: [
            { key: 'insurer_name', label: 'Seguradora', required: true, w: 25 },
            { key: 'insurer_cnpj', label: 'CNPJ da seguradora', w: 15 },
            { key: 'policy_number', label: 'Nº da apólice', required: true, w: 15 },
            { key: 'coverage', label: 'Cobertura', type: 'select', noEmpty: true, options: ['RCTR-C', 'RC-DC', 'RCF-DC', 'OUTROS'].map((v) => ({ value: v, label: v })), default: 'RCTR-C' },
            { key: 'responsible', label: 'Responsável', type: 'select', noEmpty: true, options: ['EMITENTE', 'TOMADOR'], default: 'EMITENTE' },
            { key: 'endorser', label: 'Averbadora (ex.: ATM)', w: 15 },
            fDate('valid_from', 'Vigência de'), fDate('valid_until', 'Vigência até'),
            { key: 'is_active', label: 'Ativa', type: 'bool', default: true, w: 8 },
            fNotes(),
          ],
        }],
      },
    },
  ],
});

