// ╔══════════════════════════════════════════════════════════════════════╗
// ║ balancoPatrimonialApi.js — DAO/API (CRUD + ensureTable + filtros)   ║
/* ║ Padrão: ESM, Postgres, ordenação segura, paginação                  ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

import pool from '../../config/db.js';

/** Execução de queries com retorno de linhas */
async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

/** Ordenação segura */
function parseOrder(orderBy, allowed = []) {
  if (!orderBy) return '';
  const [col, dirRaw] = String(orderBy).trim().split(/\s+/);
  const colSafe = allowed.includes(col) ? col : null;
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';
  return colSafe ? ` ORDER BY "${colSafe}" ${dir} ` : '';
}

/** Monta WHERE dinâmico a partir dos filtros */
function buildWhere({ q:search, categoria, dt_from, dt_to }) {
  const where = [];
  const params = [];
  let i = 1;

  if (search) {
    where.push(`("asset_code" ILIKE $${i} OR "descricao" ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }
  if (categoria) {
    where.push(`"categoria" = $${i++}`);
    params.push(categoria);
  }
  if (dt_from) {
    where.push(`"data_aquisicao" >= $${i++}`);
    params.push(dt_from);
  }
  if (dt_to) {
    where.push(`"data_aquisicao" <= $${i++}`);
    params.push(dt_to);
  }
  return { whereSql: where.length ? ` WHERE ${where.join(' AND ')} ` : '', params };
}

/** Criação das tabelas (idempotente) */
export async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public."balancoPatrimonial" (
      id                   BIGSERIAL PRIMARY KEY,
      asset_code           VARCHAR(50)  NOT NULL,
      descricao            VARCHAR(255) NOT NULL,
      categoria            VARCHAR(100),
      data_aquisicao       DATE         NOT NULL,
      valor_aquisicao      NUMERIC(14,2) NOT NULL,
      vida_util_meses      INTEGER,
      metodo_depreciacao   VARCHAR(30),
      taxa_anual           NUMERIC(6,3),
      valor_residual       NUMERIC(14,2),
      centro_custo_id      INTEGER,
      nfe_chave            VARCHAR(60),
      nfe_arquivo_url      TEXT,
      anexos_count         INTEGER NOT NULL DEFAULT 0,
      observacao           TEXT,
      ativo                BOOLEAN NOT NULL DEFAULT TRUE,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public."balancoPatrimonialAnexos" (
      id                BIGSERIAL PRIMARY KEY,
      balanco_id        BIGINT NOT NULL REFERENCES public."balancoPatrimonial"(id) ON DELETE CASCADE,
      tipo              VARCHAR(20) NOT NULL,
      filename          VARCHAR(255) NOT NULL,
      url               TEXT NOT NULL,
      mime              VARCHAR(100),
      tamanho_bytes     BIGINT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bp_asset_code ON public."balancoPatrimonial"("asset_code");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bp_categoria ON public."balancoPatrimonial"("categoria");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bp_data_aquisicao ON public."balancoPatrimonial"("data_aquisicao");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bpa_balanco_id ON public."balancoPatrimonialAnexos"("balanco_id");`);
}

/** Lista com filtros e paginação */
export async function list({ q:search, categoria, dt_from, dt_to, limit = 50, offset = 0, orderBy = 'data_aquisicao DESC' } = {}) {
  const allowedOrder = ['data_aquisicao','valor_aquisicao','created_at','updated_at','asset_code'];
  const orderSql = parseOrder(orderBy, allowedOrder) || ' ORDER BY "data_aquisicao" DESC ';
  const { whereSql, params } = buildWhere({ q:search, categoria, dt_from, dt_to });

  const data = await q(
    `
    SELECT bp.*,
      COALESCE((
        SELECT COUNT(*) FROM public."balancoPatrimonialAnexos" a WHERE a.balanco_id = bp.id
      ),0)::int AS anexos_count
    FROM public."balancoPatrimonial" bp
    ${whereSql}
    ${orderSql}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `,
    [...params, Number(limit), Number(offset)]
  );

  const [{ n: total }] = await q(
    `SELECT COUNT(*)::int AS n FROM public."balancoPatrimonial" ${whereSql}`,
    params
  );

  return { data, total };
}

/** Busca por ID */
export async function getById(id) {
  const [row] = await q(`SELECT * FROM public."balancoPatrimonial" WHERE id=$1`, [Number(id)]);
  return row || null;
}

/** Criação */
export async function create(payload = {}) {
  // aplica defaults quando undefined (sem sobrescrever valores válidos)
  const safe = {
    asset_code:          payload.asset_code ?? null,
    descricao:           payload.descricao ?? null,
    categoria:           payload.categoria ?? null,
    data_aquisicao:      payload.data_aquisicao ?? null,
    valor_aquisicao:     payload.valor_aquisicao ?? null,
    vida_util_meses:     payload.vida_util_meses ?? null,
    metodo_depreciacao:  payload.metodo_depreciacao ?? null,
    taxa_anual:          payload.taxa_anual ?? null,
    valor_residual:      payload.valor_residual ?? null,
    centro_custo_id:     payload.centro_custo_id ?? null,
    nfe_chave:           payload.nfe_chave ?? null,
    nfe_arquivo_url:     payload.nfe_arquivo_url ?? null,
    observacao:          payload.observacao ?? null,
    // 👇 se não vier, vira TRUE (não deixa ir NULL e respeita a regra de negócio)
    ativo:               (payload.ativo ?? true)
  };

  const cols = [
    'asset_code','descricao','categoria','data_aquisicao','valor_aquisicao',
    'vida_util_meses','metodo_depreciacao','taxa_anual','valor_residual',
    'centro_custo_id','nfe_chave','nfe_arquivo_url','observacao','ativo'
  ];
  const params = cols.map((c) => safe[c]);
  const placeholders = params.map((_, i) => `$${i+1}`).join(',');

  const [row] = await q(
    `INSERT INTO public."balancoPatrimonial" ("${cols.join('","')}")
     VALUES (${placeholders}) RETURNING *`,
    params
  );
  return row;
}

/** Atualização parcial */
export async function update(id, payload = {}) {
  const cols = [
    'asset_code','descricao','categoria','data_aquisicao','valor_aquisicao',
    'vida_util_meses','metodo_depreciacao','taxa_anual','valor_residual',
    'centro_custo_id','nfe_chave','nfe_arquivo_url','observacao','ativo'
  ];
  const sets = [];
  const params = []
  let i = 1;
  for (const c of cols) {
    if (Object.prototype.hasOwnProperty.call(payload, c)) {
      sets.push(`"${c}"=$${i++}`);
      params.push(payload[c]);
    }
  }
  if (!sets.length) throw new Error('Nada a atualizar');
  params.push(Number(id));
  const [row] = await q(
    `UPDATE public."balancoPatrimonial" SET ${sets.join(', ')}, "updated_at"=NOW() WHERE id=$${i} RETURNING *`,
    params
  );
  return row;
}

/** Remoção */
export async function remove(id) {
  await pool.query(`DELETE FROM public."balancoPatrimonial" WHERE id=$1`, [Number(id)]);
  return true;
}
