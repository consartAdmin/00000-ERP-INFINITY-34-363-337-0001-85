// backend/scripts/restoreMenuLayout.js
// Volta a POSIÇÃO dos itens do menu (tipo, "dentro de" e ordem) para o layout
// original (moduleSystemMenu.seed.js), sem mexer no resto.
//
// Uso: a tela "Documentação dos Módulos" (antes do PR #29) gravava no menu e
// tirou itens do lugar (ex.: Produtos e Clientes foram para o topo).
//
// Simulação (mostra o que muda e desfaz no final):
//   node --env-file=.env scripts/restoreMenuLayout.js
// Gravar de verdade:
//   node --env-file=.env scripts/restoreMenuLayout.js --apply
// Também voltar nome e ativo/inativo originais:
//   node --env-file=.env scripts/restoreMenuLayout.js --apply --names --active
//
// O que NÃO faz: não cria nem apaga itens, não mexe em acessos, nem em itens
// que não existem no layout original (ex.: módulos Consart criados depois).
'use strict';

import 'dotenv/config';
import pool from '../config/db.js';
import { MENU_SEED } from './moduleSystemMenu.seed.js';

const TABLE = 'public."moduleSystem"';
const SORT_STEP = 10;

const apply = process.argv.includes('--apply');
const withNames = process.argv.includes('--names');
const withActive = process.argv.includes('--active');

/** Achata a árvore do seed: cada item com o item pai, ordem e ativo herdado */
function flattenSeed(items, parent = null, parentActive = true, out = []) {
  items.forEach((item, index) => {
    const node = { item, parent, sortOrder: (index + 1) * SORT_STEP, active: parentActive && item.active !== false };
    out.push(node);
    if (item.children) flattenSeed(item.children, node, node.active, out);
  });
  return out;
}

const normPath = (p) => String(p ?? '').trim().replace(/^["']+|["']+$/g, '').trim() || '#';

async function main() {
  console.log(apply ? '▶️  Restaurar layout do menu (GRAVANDO)' : '🧪 Restaurar layout do menu (SIMULAÇÃO — use --apply para gravar)');
  const client = await pool.connect();
  const changes = [];
  const skipped = [];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, name, path, is_active, menu_type, parent_id, sort_order FROM ${TABLE}`
    );
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const nodes = flattenSeed(MENU_SEED);

    // id no banco de cada item do seed (itens sem id fixo: pelo endereço da tela,
    // fora os ids que já são de outro item do seed)
    const dbId = new Map();
    const fixedIds = new Set(nodes.map((n) => n.item.id).filter((id) => id != null));
    for (const node of nodes) {
      const { item } = node;
      if (item.id != null) {
        if (byId.has(item.id)) dbId.set(node, item.id);
        else skipped.push(`id ${item.id} ${item.label} (não existe no banco)`);
        continue;
      }
      const path = item.type === 'link' ? normPath(item.href) : '#';
      const found = rows.filter((r) => normPath(r.path) === path && r.menu_type === item.type && !fixedIds.has(Number(r.id)));
      if (found.length === 1) dbId.set(node, Number(found[0].id));
      else skipped.push(`${item.label} (${found.length ? 'mais de um' : 'nenhum'} item com ${path})`);
    }

    for (const node of nodes) {
      const id = dbId.get(node);
      if (id == null) continue;
      const current = byId.get(id);
      const parentId = node.parent ? dbId.get(node.parent) ?? null : null;
      if (node.parent && parentId == null) {
        skipped.push(`id ${id} ${current.name} (o item pai original não foi encontrado)`);
        continue;
      }

      const wanted = { menu_type: node.item.type, parent_id: parentId, sort_order: node.sortOrder };
      if (withNames) wanted.name = node.item.label;
      if (withActive) wanted.is_active = node.active;

      const diff = Object.keys(wanted).filter((k) => {
        const a = current[k] == null ? null : String(current[k]);
        const b = wanted[k] == null ? null : String(wanted[k]);
        return a !== b;
      });
      if (!diff.length) continue;

      const fmt = (k, v) => (k === 'parent_id' && v != null ? `${v} ${byId.get(Number(v))?.name ?? ''}`.trim() : v);
      changes.push({
        id,
        name: current.name,
        diff: diff.map((k) => `${k}: ${fmt(k, current[k]) ?? '—'} → ${fmt(k, wanted[k]) ?? '—'}`),
      });
      await client.query(
        `UPDATE ${TABLE} SET ${diff.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${diff.length + 1}`,
        [...diff.map((k) => wanted[k]), id]
      );
    }

    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nItens que voltam para o lugar original: ${changes.length}`);
  changes.forEach((c) => console.log(`  id ${c.id} ${c.name}\n    ${c.diff.join('\n    ')}`));
  if (skipped.length) {
    console.log('\nNão alterados (conferir na Criação de Módulos):');
    skipped.forEach((s) => console.log(`  ${s}`));
  }
  console.log(apply ? '\n✅ Gravado.' : '\n🧪 Simulação concluída. Nada foi gravado. Rode com --apply para gravar.');
}

main()
  .catch((err) => {
    console.error('❌ Falha ao restaurar o layout do menu:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
