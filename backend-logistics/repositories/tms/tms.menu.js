/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: tms.menu.js                                                   ║
   ║ MODULE: Transporte (TMS)                                            ║
   ║ DESCRIPTION: registra o menu "🚛 Transporte" no moduleSystem        ║
   ║   - dropdown novo no topo, logo depois do menu que tem 🚚 Logística ║
   ║   - submenus: Documentos Fiscais, Comercial, Operação, Frota, Gestão║
   ║   - libera os itens novos para quem já acessa 🚚 Logística          ║
   ║   - só INSERE o que falta (procura pelo caminho da tela): não mexe  ║
   ║     em item que já existe, nem reativa item desligado na tela       ║
   ║     "Criação de Módulos". Pode rodar mais de uma vez.               ║
   ║ CONSART LOGISTICS · PostgreSQL · ESM                                ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../config/db.js';
import { ensureTable } from '../moduleSystem/moduleSystemSchema.repository.js';

const TABLE = 'public."moduleSystem"';
const DROPDOWN_HTML_ID = 'gestao-transporte';

export const TMS_MENU = Object.freeze([
  { label: '📄 Documentos Fiscais ▹', links: [
    { label: '📄 CT-e (Conhecimento de Transporte)', file: 'cte.html' },
    { label: '🧾 MDF-e (Manifesto de Carga)', file: 'mdfe.html' },
  ] },
  { label: '💼 Comercial ▹', links: [
    { label: '💲 Tabelas de Frete', file: 'freightTables.html' },
    { label: '🧮 Cotações de Frete', file: 'freightQuotes.html' },
    { label: '📦 Ordens de Coleta', file: 'pickupOrders.html' },
    { label: '💰 Faturamento de Fretes', file: 'freightInvoices.html' },
    { label: '🔁 EDI (NOTFIS · OCOREN · CONEMB · DOCCOB)', file: 'edi.html' },
  ] },
  { label: '🗺️ Operação ▹', links: [
    { label: '🗺️ Planejamento de Carga', file: 'loadPlans.html' },
    { label: '📍 Ocorrências de Entrega', file: 'deliveryEvents.html' },
    { label: '🤝 Contratos de Frete (TAC · CIOT)', file: 'driverContracts.html' },
    { label: '⏱️ Jornada de Motoristas', file: 'driverJourneys.html' },
  ] },
  { label: '🔧 Frota ▹', links: [
    { label: '🔧 Manutenção (OS e Planos)', file: 'maintenance.html' },
    { label: '🛞 Pneus', file: 'tires.html' },
    { label: '⛽ Abastecimentos', file: 'fuel.html' },
    { label: '📑 Documentos e Multas', file: 'vehicleDocuments.html' },
  ] },
  { label: '📊 Gestão ▹', links: [
    { label: '📊 Resultado por Viagem', file: 'tripProfit.html' },
  ] },
]);

async function insertRow(client, values) {
  const { rows: [row] } = await client.query(
    `INSERT INTO ${TABLE}
        (id, name, path, is_active, menu_type, parent_id, sort_order, html_id, is_external, is_public)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM ${TABLE}), $1, $2, TRUE, $3, $4, $5, $6, FALSE, FALSE)
     RETURNING id`,
    [values.name, values.path, values.menu_type, values.parent_id, values.sort_order, values.html_id ?? null]
  );
  return Number(row.id);
}

/**
 * Registra o menu do TMS. Recebe um client (dentro de transação) ou usa o pool.
 * @returns {{ inserted: number[], accessGranted: number }}
 */
export async function registerTmsMenu(client) {
  await ensureTable((text, params) => client.query(text, params));
  await client.query(`LOCK TABLE ${TABLE} IN SHARE ROW EXCLUSIVE MODE`);

  // 🚚 Logística é a referência: caminho no mesmo estilo e mesmos usuários
  const { rows: [ref] } = await client.query(`
    SELECT m.id, m.path, m.parent_id, p.sort_order AS parent_sort
      FROM ${TABLE} m
      LEFT JOIN ${TABLE} p ON p.id = m.parent_id
     WHERE m.path ILIKE '%deliveryRoutes/deliveryRoutes.html%'
     ORDER BY m.is_active DESC, m.id
     LIMIT 1
  `);
  const prefix = ref?.path && /deliveryRoutes\/deliveryRoutes\.html/i.test(ref.path)
    ? ref.path.replace(/deliveryRoutes\/deliveryRoutes\.html.*$/i, '').trim()
    : '../';

  const inserted = [];

  // 1) Dropdown "🚛 Transporte"
  let { rows: [dropdown] } = await client.query(
    `SELECT id FROM ${TABLE} WHERE menu_type = 'dropdown' AND html_id = $1 ORDER BY id LIMIT 1`,
    [DROPDOWN_HTML_ID]
  );
  let dropdownId = dropdown ? Number(dropdown.id) : null;
  if (!dropdownId) {
    let sortOrder = ref?.parent_sort != null ? Number(ref.parent_sort) + 5 : null;
    if (sortOrder == null) {
      const { rows: [mx] } = await client.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 10 AS s FROM ${TABLE} WHERE parent_id IS NULL AND menu_type IS NOT NULL`
      );
      sortOrder = Number(mx.s);
    }
    dropdownId = await insertRow(client, {
      name: '🚛 Transporte ', path: '#', menu_type: 'dropdown', parent_id: null,
      sort_order: sortOrder, html_id: DROPDOWN_HTML_ID,
    });
    inserted.push(dropdownId);
  }

  // 2) Submenus e telas
  for (const [gi, group] of TMS_MENU.entries()) {
    let { rows: [sub] } = await client.query(
      `SELECT id FROM ${TABLE} WHERE menu_type = 'submenu' AND parent_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
      [dropdownId, group.label]
    );
    let subId = sub ? Number(sub.id) : null;
    if (!subId) {
      subId = await insertRow(client, {
        name: group.label, path: '#', menu_type: 'submenu', parent_id: dropdownId, sort_order: (gi + 1) * 10,
      });
      inserted.push(subId);
    }

    for (const [li, link] of group.links.entries()) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM ${TABLE} WHERE path ILIKE $1 LIMIT 1`,
        [`%tms/${link.file}%`]
      );
      if (rowCount) continue;
      inserted.push(await insertRow(client, {
        name: link.label, path: `${prefix}tms/${link.file}`, menu_type: 'link', parent_id: subId,
        sort_order: (li + 1) * 10,
      }));
    }
  }

  if (inserted.length) {
    const { rows: [seq] } = await client.query(
      `SELECT pg_get_serial_sequence('public."moduleSystem"', 'id') AS name`
    );
    if (seq?.name) {
      await client.query(`SELECT setval($1::regclass, (SELECT MAX(id) FROM ${TABLE}))`, [seq.name]);
    }
  }

  // 3) Acesso para quem já abre 🚚 Logística
  let accessGranted = 0;
  if (ref && inserted.length) {
    const { rowCount } = await client.query(
      `INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
       SELECT um.usuario_id, n.id, TRUE
         FROM public."userModules" um
        CROSS JOIN UNNEST($1::bigint[]) AS n(id)
        WHERE um.modulo_id = $2
          AND um.pode_acessar = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM public."userModules" x
             WHERE x.usuario_id = um.usuario_id AND x.modulo_id = n.id
          )`,
      [inserted, ref.id]
    );
    accessGranted = rowCount;
  }

  return { inserted, accessGranted };
}

let menuPromise = null;

/** Versão usada no boot do servidor: roda uma vez, em transação própria */
export function ensureTmsMenu() {
  if (!menuPromise) {
    menuPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await registerTmsMenu(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => {
      menuPromise = null;
      throw err;
    });
  }
  return menuPromise;
}
