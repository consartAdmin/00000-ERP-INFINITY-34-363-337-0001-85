// ╔══════════════════════════════════════════════════════════════════════╗
// ║ assistantCounts.js — contagens de clientes para a Consart (IA)       ║
// ║ "Quantos clientes tenho?", "quantos por vendedor/cidade/UF?".        ║
// ║ SOMENTE LEITURA (SELECT COUNT). Usa a mesma tabela, JOINs e filtros  ║
// ║ da lista de clientes do ERP (empresa da request: BH3 ou CONSART).    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../config/db.js';
import { tb } from '../repositories/customers/customers.table.js';
import { ALIAS } from '../repositories/customers/customers.constants.js';
import { CUSTOMER_FULL_JOINS, buildCustomerFilters } from '../repositories/customers/customers.sql.js';
import { erpTable } from '../utils/erpCompanyContext.js';

const c = ALIAS;

const GROUPS = Object.freeze({
  vendedor: `COALESCE(NULLIF(TRIM(COALESCE(s.nickname, s.name)), ''), 'Sem vendedor')`,
  cidade: `COALESCE(NULLIF(TRIM(${c}.city), ''), 'Sem cidade') || COALESCE('/' || NULLIF(TRIM(${c}.state), ''), '')`,
  uf: `COALESCE(NULLIF(UPPER(TRIM(${c}.state)), ''), 'Sem UF')`,
  segmento: `COALESCE(NULLIF(TRIM(seg.segment_name), ''), 'Sem segmento')`,
  status: `COALESCE(cst.name_pt, cst.internal_code, 'Sem status')`,
  ativo: `CASE WHEN ${c}.is_active THEN 'Ativos' ELSE 'Inativos' END`,
});

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s ? s : undefined;
};

/** Vendedor vinculado ao usuário logado (Usuário x Vendedor), se houver. */
export async function sellerOfUser(userId) {
  if (!Number.isFinite(Number(userId))) return null;
  try {
    const { rows } = await pool.query(
      `SELECT sbu.seller_id, COALESCE(s.nickname, s.name) AS seller_name
         FROM public."sellerByUser" sbu
         LEFT JOIN ${erpTable('public.sellers')} s ON s.id = sbu.seller_id
        WHERE sbu.user_id = $1 AND (sbu.active IS NULL OR sbu.active = TRUE)
        ORDER BY sbu.is_primary DESC NULLS LAST, sbu.id ASC
        LIMIT 1`,
      [Number(userId)],
    );
    return rows[0] ? { id: Number(rows[0].seller_id), nome: rows[0].seller_name ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Conta clientes com filtros opcionais e, se pedido, agrupa.
 * input: { situacao: 'ATIVOS'|'INATIVOS'|'TODOS', minha_carteira, vendedor, vendedor_id,
 *          sem_vendedor, cidade, uf, segmento, agrupar_por }
 */
export async function countCustomers(input = {}, ctx = {}) {
  const situacao = String(input.situacao ?? 'ATIVOS').toUpperCase();
  const is_active = situacao === 'TODOS' ? undefined : situacao !== 'INATIVOS';

  const meuVendedor = await sellerOfUser(ctx.userId);
  let seller_id = Number.isFinite(Number(input.vendedor_id)) && clean(input.vendedor_id)
    ? Number(input.vendedor_id)
    : undefined;
  const avisos = [];
  if (input.minha_carteira) {
    if (meuVendedor?.id) seller_id = meuVendedor.id;
    else avisos.push('O usuário não tem vendedor vinculado (Usuário x Vendedor); contei todos os clientes da empresa.');
  }

  const { params, whereSql } = buildCustomerFilters({ is_active, seller_id });
  const where = whereSql ? [whereSql.replace(/^WHERE /, '')] : [];

  const vendedor = clean(input.vendedor);
  if (vendedor && seller_id === undefined) {
    params.push(`%${vendedor.toLowerCase()}%`);
    where.push(`LOWER(COALESCE(s.nickname, '') || ' ' || COALESCE(s.name, '')) LIKE $${params.length}`);
  }
  if (input.sem_vendedor) where.push('sfc.seller_id IS NULL');
  const cidade = clean(input.cidade);
  if (cidade) {
    params.push(cidade.toLowerCase());
    where.push(`LOWER(TRIM(COALESCE(${c}.city, ''))) = $${params.length}`);
  }
  const uf = clean(input.uf);
  if (uf) {
    params.push(uf.toUpperCase());
    where.push(`UPPER(TRIM(COALESCE(${c}.state, ''))) = $${params.length}`);
  }
  const segmento = clean(input.segmento);
  if (segmento) {
    params.push(`%${segmento.toLowerCase()}%`);
    where.push(`LOWER(COALESCE(seg.segment_name, '')) LIKE $${params.length}`);
  }

  const from = `FROM ${tb()} ${c}\n${CUSTOMER_FULL_JOINS()}\n${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const totalSql = `SELECT COUNT(DISTINCT ${c}.customer_id)::INT AS total ${from}`;
  const groupExpr = GROUPS[String(input.agrupar_por ?? '').toLowerCase()];
  const groupSql = groupExpr
    ? `SELECT ${groupExpr} AS grupo, COUNT(DISTINCT ${c}.customer_id)::INT AS clientes
       ${from}
       GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 40`
    : null;

  const [totalRes, groupRes] = await Promise.all([
    pool.query(totalSql, params),
    groupSql ? pool.query(groupSql, params) : Promise.resolve(null),
  ]);

  const out = {
    total_clientes: totalRes.rows[0]?.total ?? 0,
    filtros: {
      situacao: situacao === 'TODOS' ? 'todos' : is_active ? 'só ativos' : 'só inativos',
      vendedor: seller_id !== undefined
        ? (seller_id === meuVendedor?.id ? `${meuVendedor.nome ?? seller_id} (vendedor do usuário)` : seller_id)
        : vendedor,
      sem_vendedor: input.sem_vendedor ? true : undefined,
      cidade, uf, segmento,
    },
    vendedor_do_usuario: meuVendedor ?? 'nenhum vinculado',
  };
  if (groupRes) {
    out.agrupado_por = String(input.agrupar_por).toLowerCase();
    out.grupos = groupRes.rows.map((r) => ({ grupo: r.grupo, clientes: r.clientes }));
    if (groupRes.rows.length === 40) avisos.push('Mostrando só os 40 maiores grupos.');
  }
  if (avisos.length) out.avisos = avisos;
  return out;
}
