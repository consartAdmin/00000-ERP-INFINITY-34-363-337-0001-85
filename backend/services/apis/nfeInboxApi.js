// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInboxApi.js — DAL Caixa de Entrada NF-e (ESM | PostgreSQL)       ║
// ║ Tabela: public."nfeInbox"                                           ║
// ║ Funções: ensureTable, list, count, getById, upsertFromParsedNfe...  ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB = 'public."nfeInbox"';

// Tamanho mínimo para considerar que xml_completo tem conteúdo real
// (um resumo/stub da DF-e é bem menor que isso). Usado no SELECT e no UPSERT.
const MIN_XML_LEN = 200;

// ======================================================================
// Helpers
// ======================================================================
function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** CNPJ normalizado: 14 dígitos ou null (evita estourar VARCHAR(14)). */
function cnpj14(v) {
  const d = onlyDigits(v);
  return d.length === 14 ? d : null;
}

/**
 * Number seguro: nunca devolve NaN.
 * NUMERIC do Postgres ACEITA 'NaN' como valor válido — sem esta guarda um
 * valor_total malformado entra no banco e contamina todo SUM() futuro.
 * BIGINT rejeita NaN e quebraria o INSERT em runtime.
 */
function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Escapa os metacaracteres de LIKE/ILIKE.
 * Sem isso, buscar "100%" casa com tudo e "a_b" casa com "axb".
 * Sempre usar junto de ESCAPE '\' na query.
 */
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

function buildListFilters({
  cnpjEmpresa,
  situacao,
  manifestacao,
  dataIni,
  dataFim,
  q,
} = {}) {
  const values = [];
  const where = [];

  if (cnpjEmpresa) {
    values.push(onlyDigits(cnpjEmpresa));
    where.push(`ni.cnpj_empresa = $${values.length}`);
  }

  if (situacao) {
    values.push(String(situacao));
    where.push(`ni.situacao = $${values.length}`);
  }

  if (manifestacao) {
    // Compara a operação dentro do JSONB, não o JSON serializado:
    // ILIKE sobre manifestacao::text casaria também com nomes de chave
    // e nunca usaria o índice GIN.
    values.push(String(manifestacao));
    where.push(`ni.manifestacao->>'operacao' = $${values.length}`);
  }

  if (dataIni) {
    values.push(dataIni);
    where.push(`COALESCE(ni.data_autorizacao, ni.data_emissao) >= $${values.length}::date`);
  }

  if (dataFim) {
    values.push(dataFim);
    where.push(`COALESCE(ni.data_autorizacao, ni.data_emissao) < ($${values.length}::date + INTERVAL '1 day')`);
  }

  if (q) {
    const search = String(q).trim();
    const qDigits = onlyDigits(search);

    if (qDigits.length === 44) {
      values.push(qDigits);
      where.push(`ni.chave_nfe = $${values.length}`);
    } else {
      values.push(`%${escapeLike(search)}%`);
      const textIdx = values.length;

      const conds = [
        `COALESCE(ni.numero, '') ILIKE $${textIdx} ESCAPE '\\'`,
        `COALESCE(ni.emitente_razao, '') ILIKE $${textIdx} ESCAPE '\\'`,
        `COALESCE(ni.destinatario_razao, '') ILIKE $${textIdx} ESCAPE '\\'`,
        `COALESCE(ni.chave_nfe, '') ILIKE $${textIdx} ESCAPE '\\'`,
      ];

      // CNPJ é gravado só com dígitos: buscar "12.345.678/0001-99" na coluna
      // crua nunca casa. Compara a forma normalizada em paralelo.
      if (qDigits.length >= 8) {
        values.push(`%${qDigits}%`);
        const digitIdx = values.length;
        conds.push(
          `COALESCE(ni.emitente_cnpj, '') LIKE $${digitIdx}`,
          `COALESCE(ni.destinatario_cnpj, '') LIKE $${digitIdx}`
        );
      }

      where.push(`(${conds.join(' OR ')})`);
    }
  }

  return {
    values,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
  };
}

// ======================================================================
// Projeção da listagem
// xml_completo (TEXT, dezenas/centenas de KB por nota) fica FORA daqui:
// com limit=100 a grade trafegaria megabytes por página sem necessidade —
// a flag has_xml já diz ao frontend se existe XML para baixar.
// Listar coluna a coluna também elimina o `entrada_criada` duplicado que
// `ni.*` criava junto da coluna calculada.
// ======================================================================
const LIST_COLUMNS = `
  ni.id,
  ni.cnpj_empresa,
  ni.chave_nfe,
  ni.nsu,
  ni.situacao,
  ni.tipo_operacao,
  ni.modelo,
  ni.serie,
  ni.numero,
  ni.emitente_cnpj,
  ni.emitente_razao,
  ni.destinatario_cnpj,
  ni.destinatario_razao,
  ni.data_emissao,
  ni.data_autorizacao,
  ni.valor_total,
  ni.xml_resumido,
  ni.manifestacao,
  ni.manifestado_em,
  ni.origem,
  ni.entrada_criada AS entrada_criada_flag,
  ni.created_at,
  ni.updated_at
`;

// ======================================================================
// JOIN com inboundInvoices
// LATERAL + LIMIT 1: access_key não é única em inboundInvoices (reentrada,
// correção, importação repetida). Com LEFT JOIN simples uma chave duplicada
// multiplicava a linha em list() enquanto count() — que não tem JOIN —
// continuava contando 1, desalinhando a paginação.
// ======================================================================
const INBOUND_JOIN = `
  LEFT JOIN LATERAL (
    SELECT i.inbound_id
    FROM public."inboundInvoices" i
    WHERE i.access_key = ni.chave_nfe
    ORDER BY i.inbound_id DESC
    LIMIT 1
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT e.expenseentryid
    FROM public."expenseEntries" e
    WHERE e.documentkey = ni.chave_nfe
      AND UPPER(COALESCE(e.status, '')) <> 'CANCELED'
    ORDER BY e.expenseentryid DESC
    LIMIT 1
  ) exp ON true
`;

// Nota lançada como Entrada Fiscal (estoque) OU como Entrada de Despesa
// (uso e consumo) conta como "Já lançada" nos dois módulos.
const ENTRADA_CRIADA_EXPR = `
  (inv.inbound_id IS NOT NULL OR exp.expenseentryid IS NOT NULL OR ni.entrada_criada = true)
`;

// substr antes do length permite detoast parcial do TEXT: char_length()
// sobre a coluna inteira obrigava a descompactar todo o XML linha a linha.
const HAS_XML_EXPR = `
  (length(substr(ni.xml_completo, 1, ${MIN_XML_LEN + 1})) > ${MIN_XML_LEN})
`;

// ======================================================================
// Ordenação
// O mapa abaixo é a única fonte de SQL de ordenação. Nada vindo do
// cliente é interpolado na query: `sort` é apenas uma chave de busca
// neste objeto e `order` só pode produzir os literais ASC ou DESC.
// ======================================================================
const SORT_COLUMNS = Object.freeze({
  // Mesma regra usada na exibição: autorização com fallback para emissão.
  data_autorizacao: `COALESCE(ni.data_autorizacao, ni.data_emissao)`,

  chave_nfe: `ni.chave_nfe`,

  // numero é VARCHAR: ordenar como texto colocaria '1000' antes de '999'.
  // Extrai só dígitos e ordena numericamente; não-numéricos viram NULL.
  // ::numeric (e não ::bigint) porque a coluna aceita até 20 dígitos.
  numero: `NULLIF(regexp_replace(COALESCE(ni.numero, ''), '\\D', '', 'g'), '')::numeric`,

  emitente_razao: `COALESCE(ni.emitente_razao, ni.emitente_cnpj)`,

  destinatario_razao: `COALESCE(ni.destinatario_razao, ni.destinatario_cnpj)`,

  valor_total: `ni.valor_total`,

  // Coluna calculada no SELECT: precisa repetir a expressão, senão o
  // ORDER BY cairia na coluna-base e ignoraria o JOIN de inboundInvoices.
  entrada_criada: ENTRADA_CRIADA_EXPR,

  // manifestacao é JSONB; extrai a operação com cast como fallback.
  manifestacao: `COALESCE(ni.manifestacao->>'operacao', ni.manifestacao::text)`,
});

/** Colunas aceitas em `sort` (espelha o whitelist do frontend). */
export const SORTABLE_COLUMNS = Object.freeze(Object.keys(SORT_COLUMNS));

export const DEFAULT_SORT_COLUMN = 'data_autorizacao';
export const DEFAULT_SORT_DIRECTION = 'desc';

function buildOrderBy(sort, order) {
  const expr =
    SORT_COLUMNS[String(sort || '').trim()] ||
    SORT_COLUMNS[DEFAULT_SORT_COLUMN];

  const dir =
    String(order || '').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // ni.id como desempate: sem ele, registros com valores iguais podem
  // trocar de posição entre páginas, repetindo ou escondendo linhas.
  //
  // NULLS LAST é obrigatório aqui E na definição do índice
  // idx_nfeinbox_data_ord_v2: em índice, DESC significa DESC NULLS FIRST,
  // e o planner só aproveita o índice se as duas cláusulas baterem.
  return `ORDER BY ${expr} ${dir} NULLS LAST, ni.id DESC`;
}

// ======================================================================
// CREATE / MIGRATE TABLE (idempotente + ajustes de colunas)
// ======================================================================
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id                 SERIAL PRIMARY KEY,
        cnpj_empresa       VARCHAR(14) NOT NULL,
        chave_nfe          VARCHAR(44) NOT NULL UNIQUE,

        nsu                BIGINT,
        situacao           VARCHAR(20) NOT NULL,

        tipo_operacao      VARCHAR(10),
        modelo             VARCHAR(4),
        serie              VARCHAR(10),
        numero             VARCHAR(20),

        emitente_cnpj      VARCHAR(14),
        emitente_razao     TEXT,
        destinatario_cnpj  VARCHAR(14),
        destinatario_razao TEXT,

        data_emissao       TIMESTAMP,
        data_autorizacao   TIMESTAMP,
        valor_total        NUMERIC(18,2),

        xml_resumido       JSONB,
        xml_completo       TEXT,

        manifestacao       JSONB,
        manifestado_em     TIMESTAMP,

        created_at         TIMESTAMP NOT NULL DEFAULT now(),
        updated_at         TIMESTAMP NOT NULL DEFAULT now(),

        origem             VARCHAR(30),
        entrada_criada     BOOLEAN DEFAULT false
      );
    `);

    // Migra / garante colunas
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS nsu BIGINT;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS tipo_operacao VARCHAR(10);`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS xml_resumido JSONB;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS xml_completo TEXT;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS manifestacao JSONB;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS manifestado_em TIMESTAMP;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS origem VARCHAR(30);`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS entrada_criada BOOLEAN DEFAULT false;`);

    // CREATE TABLE IF NOT EXISTS não altera tabela pré-existente: se o banco
    // foi criado antes do UNIQUE, todo ON CONFLICT (chave_nfe) falha com
    // 42P10. Falhar aqui, no boot, é o momento certo de descobrir — e vai
    // falhar ruidosamente se já existirem chaves duplicadas a resolver.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = '${TB}'::regclass
            AND contype = 'u'
        ) THEN
          ALTER TABLE ${TB}
            ADD CONSTRAINT nfeinbox_chave_nfe_key UNIQUE (chave_nfe);
        END IF;
      END $$;
    `);

    // Índices redundantes/obsoletos removidos:
    //  - idx_nfeinbox_chave: duplicava o índice implícito do UNIQUE;
    //  - idx_nfeinbox_data: (data_emissao, data_autorizacao) não atende o
    //    COALESCE da listagem e nenhuma outra query usa;
    //  - idx_nfeinbox_data_ord: versão antiga sem NULLS LAST, que o planner
    //    nunca conseguia usar. Recriado abaixo com outro nome, porque
    //    CREATE INDEX IF NOT EXISTS não redefine índice já existente.
    await client.query(`DROP INDEX IF EXISTS public.idx_nfeinbox_chave;`);
    await client.query(`DROP INDEX IF EXISTS public.idx_nfeinbox_data;`);
    await client.query(`DROP INDEX IF EXISTS public.idx_nfeinbox_data_ord;`);

    // Índices
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfeinbox_cnpj_empresa ON ${TB} (cnpj_empresa);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfeinbox_destinatario ON ${TB} (destinatario_cnpj);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfeinbox_situacao ON ${TB} (situacao);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfeinbox_nsu ON ${TB} (nsu);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfeinbox_entrada_criada ON ${TB} (entrada_criada);`);

    // Ordenação padrão da listagem (sem filtro de empresa).
    // NULLS LAST tem que espelhar exatamente o ORDER BY de buildOrderBy().
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nfeinbox_data_ord_v2
      ON ${TB} (COALESCE(data_autorizacao, data_emissao) DESC NULLS LAST, id DESC);
    `);

    // Caso real mais comum: filtra por empresa e ordena por data.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nfeinbox_empresa_data_ord
      ON ${TB} (cnpj_empresa, COALESCE(data_autorizacao, data_emissao) DESC NULLS LAST, id DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nfeinbox_manifestacao_gin
      ON ${TB} USING GIN (manifestacao);
    `);

    await client.query('COMMIT');
  } catch (err) {
    // ROLLBACK pode falhar se a conexão caiu; sem o catch, o erro do
    // rollback substituiria o erro original e esconderia a causa real.
    await client.query('ROLLBACK').catch(() => { });
    console.error('ensureTable(nfeInbox) failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ======================================================================
// LIST + filtros (JOIN inboundInvoices + flags)
// ======================================================================
export async function list({
  cnpjEmpresa,
  situacao,
  manifestacao,
  dataIni,
  dataFim,
  q,
  sort,
  order,
  limit = 100,
  offset = 0,
} = {}) {
  const { values, whereSql } = buildListFilters({
    cnpjEmpresa,
    situacao,
    manifestacao,
    dataIni,
    dataFim,
    q,
  });

  const lim = Number(limit);
  const off = Number(offset);

  values.push(Number.isFinite(lim) && lim > 0 ? lim : 100);
  const limitIdx = values.length;

  values.push(Number.isFinite(off) && off >= 0 ? off : 0);
  const offsetIdx = values.length;

  const sql = `
    SELECT
      ${LIST_COLUMNS},
      inv.inbound_id AS inbound_invoice_id,
      (inv.inbound_id IS NOT NULL) AS has_inbound,
      ${ENTRADA_CRIADA_EXPR} AS entrada_criada,
      exp.expenseentryid AS expense_entry_id,
      ${HAS_XML_EXPR} AS has_xml
    FROM ${TB} ni
    ${INBOUND_JOIN}
    ${whereSql}
    ${buildOrderBy(sort, order)}
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}

// ======================================================================
// COUNT + mesmos filtros da listagem
// (a ordenação não altera o total, então não entra aqui; o JOIN também
//  não, porque nenhum filtro referencia inv e o LATERAL não multiplica)
// ======================================================================
export async function count({
  cnpjEmpresa,
  situacao,
  manifestacao,
  dataIni,
  dataFim,
  q,
} = {}) {
  const { values, whereSql } = buildListFilters({
    cnpjEmpresa,
    situacao,
    manifestacao,
    dataIni,
    dataFim,
    q,
  });

  const { rows } = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM ${TB} AS ni
      ${whereSql};
    `,
    values
  );

  return Number(rows[0]?.total || 0);
}

// ======================================================================
// GET BY ID (anti-NaN)
// Aqui ni.* fica: é a tela de detalhe, que precisa do xml_completo.
// A flag calculada usa outro nome para não colidir com ni.entrada_criada.
// ======================================================================
export async function getById(id) {
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return null;

  const { rows } = await pool.query(
    `
    SELECT
      ni.*,
      inv.inbound_id AS inbound_invoice_id,
      (inv.inbound_id IS NOT NULL) AS has_inbound,
      ${ENTRADA_CRIADA_EXPR} AS entrada_criada_efetiva,
      exp.expenseentryid AS expense_entry_id,
      ${HAS_XML_EXPR} AS has_xml
    FROM ${TB} AS ni
    ${INBOUND_JOIN}
    WHERE ni.id = $1;
    `,
    [idNum]
  );

  return rows[0] || null;
}

// ======================================================================
// Salvar XML completo por ID
// RETURNING enxuto: devolver * ecoaria de volta o XML recém-enviado.
// ======================================================================
export async function saveXmlCompletoById(id, xmlText) {
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return null;

  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET xml_completo = $2,
        updated_at = now()
    WHERE id = $1
    RETURNING id, chave_nfe, updated_at;
    `,
    [idNum, xmlText || null]
  );

  return rows[0] || null;
}

// ======================================================================
// UPSERT a partir de objeto normalizado (PlugNotas/DF-e)
// ======================================================================
export async function upsertFromParsedNfe(parsed = {}) {
  const {
    cnpj_empresa,
    chave_nfe,

    nsu,
    situacao,
    tipo_operacao,

    modelo,
    serie,
    numero,

    data_emissao,
    data_autorizacao,

    emitente_cnpj,
    emitente_razao,
    destinatario_cnpj,
    destinatario_razao,

    valor_total,

    xml_resumido,
    xml_completo,

    manifestacao,
    manifestado_em,

    origem,
    entrada_criada,
  } = parsed;

  const chave = onlyDigits(chave_nfe);
  if (!chave || chave.length !== 44) {
    throw new Error('upsertFromParsedNfe: chave_nfe inválida/obrigatória (44 dígitos)');
  }

  const cnpjEmpresaFinal = onlyDigits(cnpj_empresa || destinatario_cnpj || '');
  if (!cnpjEmpresaFinal || cnpjEmpresaFinal.length !== 14) {
    throw new Error('upsertFromParsedNfe: cnpj_empresa inválido/obrigatório (14 dígitos)');
  }

  // null quando o parse não trouxe situação: o default 'PENDENTE' só vale no
  // INSERT. No UPDATE, sobrescrever com 'PENDENTE' rebaixava nota já
  // manifestada/concluída a cada sincronização de resumo.
  const situacaoFinal = situacao ? String(situacao) : null;

  const sql = `
    INSERT INTO ${TB} (
      cnpj_empresa,
      chave_nfe,
      nsu,
      situacao,
      tipo_operacao,
      modelo,
      serie,
      numero,
      data_emissao,
      data_autorizacao,
      emitente_cnpj,
      emitente_razao,
      destinatario_cnpj,
      destinatario_razao,
      valor_total,
      xml_resumido,
      xml_completo,
      manifestacao,
      manifestado_em,
      origem,
      entrada_criada,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      COALESCE($4, 'PENDENTE'),
      $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16::jsonb,
      $17,
      $18::jsonb,
      $19,$20,$21,
      now()
    )
    ON CONFLICT (chave_nfe) DO UPDATE SET
      cnpj_empresa       = EXCLUDED.cnpj_empresa,
      nsu                = COALESCE(EXCLUDED.nsu, ${TB}.nsu),
      situacao           = COALESCE(EXCLUDED.situacao, ${TB}.situacao),
      tipo_operacao      = COALESCE(EXCLUDED.tipo_operacao, ${TB}.tipo_operacao),
      modelo             = COALESCE(EXCLUDED.modelo, ${TB}.modelo),
      serie              = COALESCE(EXCLUDED.serie, ${TB}.serie),
      numero             = COALESCE(EXCLUDED.numero, ${TB}.numero),
      data_emissao       = COALESCE(EXCLUDED.data_emissao, ${TB}.data_emissao),
      data_autorizacao   = COALESCE(EXCLUDED.data_autorizacao, ${TB}.data_autorizacao),
      emitente_cnpj      = COALESCE(EXCLUDED.emitente_cnpj, ${TB}.emitente_cnpj),
      emitente_razao     = COALESCE(EXCLUDED.emitente_razao, ${TB}.emitente_razao),
      destinatario_cnpj  = COALESCE(EXCLUDED.destinatario_cnpj, ${TB}.destinatario_cnpj),
      destinatario_razao = COALESCE(EXCLUDED.destinatario_razao, ${TB}.destinatario_razao),
      valor_total        = COALESCE(EXCLUDED.valor_total, ${TB}.valor_total),

      xml_resumido       = COALESCE(EXCLUDED.xml_resumido, ${TB}.xml_resumido),

      xml_completo       = CASE
        WHEN EXCLUDED.xml_completo IS NOT NULL
         AND length(substr(EXCLUDED.xml_completo, 1, ${MIN_XML_LEN + 1})) > ${MIN_XML_LEN}
          THEN EXCLUDED.xml_completo
        ELSE ${TB}.xml_completo
      END,

      manifestacao       = COALESCE(EXCLUDED.manifestacao, ${TB}.manifestacao),
      manifestado_em     = COALESCE(EXCLUDED.manifestado_em, ${TB}.manifestado_em),
      origem             = COALESCE(EXCLUDED.origem, ${TB}.origem),

      entrada_criada     = COALESCE(EXCLUDED.entrada_criada, ${TB}.entrada_criada),
      updated_at         = now()
    RETURNING *;
  `;

  const values = [
    cnpjEmpresaFinal,
    chave,

    toNumber(nsu),
    situacaoFinal,
    tipo_operacao || null,

    modelo || null,
    serie || null,
    numero != null && numero !== '' ? String(numero) : null,

    data_emissao || null,
    data_autorizacao || null,

    cnpj14(emitente_cnpj),
    emitente_razao || null,
    cnpj14(destinatario_cnpj),
    destinatario_razao || null,

    toNumber(valor_total),

    xml_resumido != null ? JSON.stringify(xml_resumido) : null,
    xml_completo || null,

    manifestacao != null ? JSON.stringify(manifestacao) : null,
    manifestado_em || null,

    origem || null,
    typeof entrada_criada === 'boolean' ? entrada_criada : null,
  ];

  const { rows } = await pool.query(sql, values);
  return rows[0];
}

export default {
  ensureTable,
  list,
  count,
  getById,
  saveXmlCompletoById,
  upsertFromParsedNfe,
  SORTABLE_COLUMNS,
  DEFAULT_SORT_COLUMN,
  DEFAULT_SORT_DIRECTION,
};
