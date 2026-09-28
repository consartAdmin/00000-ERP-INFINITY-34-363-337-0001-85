-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ KIT DE REVISÃO DE SCHEMA — para colar no pgAdmin (Query Tool)      ║
-- ║ Banco: erp-infinity-00001 · schema: public                         ║
-- ║                                                                    ║
-- ║ Cada bloco é independente: selecione o bloco e aperte F5.          ║
-- ║ Todos são SOMENTE LEITURA — nenhum altera dados ou estrutura.      ║
-- ╚════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════
-- 1. INVENTÁRIO — visão de cima: quantas tabelas, tamanho, volume
-- ════════════════════════════════════════════════════════════════════
SELECT
  c.relname                                            AS tabela,
  c.reltuples::bigint                                  AS linhas_estimadas,
  pg_size_pretty(pg_total_relation_size(c.oid))        AS tamanho_total,
  pg_size_pretty(pg_relation_size(c.oid))              AS tamanho_dados,
  pg_size_pretty(pg_total_relation_size(c.oid)
                 - pg_relation_size(c.oid))            AS tamanho_indices,
  (SELECT count(*) FROM pg_attribute a
    WHERE a.attrelid = c.oid AND a.attnum > 0
      AND NOT a.attisdropped)                          AS qtd_colunas,
  obj_description(c.oid)                               AS comentario
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')          -- r = tabela, p = particionada
ORDER BY pg_total_relation_size(c.oid) DESC;


-- ════════════════════════════════════════════════════════════════════
-- 2. RESUMO COMPACTO — 1 linha por tabela, com todas as colunas
--    O melhor bloco para "passar o olho" em tudo de uma vez.
-- ════════════════════════════════════════════════════════════════════
SELECT
  c.relname AS tabela,
  count(*)  AS colunas,
  string_agg(
    a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
      || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
    E'\n' ORDER BY a.attnum
  ) AS estrutura
FROM pg_class c
JOIN pg_namespace n  ON n.oid = c.relnamespace
JOIN pg_attribute a  ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
GROUP BY c.relname
ORDER BY c.relname;


-- ════════════════════════════════════════════════════════════════════
-- 3. TODAS AS COLUNAS DE TODAS AS TABELAS — listagem completa
--    Use o filtro do pgAdmin ou acrescente um WHERE para restringir.
-- ════════════════════════════════════════════════════════════════════
SELECT
  c.table_name                                    AS tabela,
  c.ordinal_position                              AS pos,
  c.column_name                                   AS coluna,
  c.data_type                                     AS tipo,
  COALESCE(c.character_maximum_length::text,
           c.numeric_precision::text || ','
             || COALESCE(c.numeric_scale::text,'0'),
           '—')                                   AS tamanho,
  c.is_nullable                                   AS aceita_nulo,
  COALESCE(c.column_default, '—')                 AS valor_padrao,
  c.is_identity                                   AS identity,
  col_description(
    (quote_ident(c.table_schema) || '.'
      || quote_ident(c.table_name))::regclass,
    c.ordinal_position
  )                                               AS comentario
FROM information_schema.columns c
JOIN information_schema.tables t
  ON  t.table_schema = c.table_schema
  AND t.table_name   = c.table_name
  AND t.table_type   = 'BASE TABLE'
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;


-- ════════════════════════════════════════════════════════════════════
-- 4. CHAVES E RESTRIÇÕES — PK, FK, UNIQUE, CHECK de tudo
-- ════════════════════════════════════════════════════════════════════
SELECT
  con.conrelid::regclass::text  AS tabela,
  con.conname                   AS restricao,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    WHEN 'x' THEN 'EXCLUDE'
    ELSE con.contype::text
  END                           AS tipo,
  pg_get_constraintdef(con.oid) AS definicao
FROM pg_constraint con
JOIN pg_class      c ON c.oid = con.conrelid
JOIN pg_namespace  n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY tabela, tipo, restricao;


-- ════════════════════════════════════════════════════════════════════
-- 5. ÍNDICES — todos, com definição completa e tamanho
-- ════════════════════════════════════════════════════════════════════
SELECT
  i.indrelid::regclass::text              AS tabela,
  ic.relname                              AS indice,
  CASE
    WHEN i.indisprimary THEN 'PRIMARY KEY'
    WHEN i.indisunique  THEN 'UNIQUE'
    ELSE 'INDEX'
  END                                     AS tipo,
  CASE WHEN i.indpred IS NOT NULL
       THEN 'sim' ELSE 'não' END          AS parcial,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS tamanho,
  pg_get_indexdef(i.indexrelid)           AS definicao
FROM pg_index i
JOIN pg_class     ic ON ic.oid = i.indexrelid
JOIN pg_class     tc ON tc.oid = i.indrelid
JOIN pg_namespace n  ON n.oid  = tc.relnamespace
WHERE n.nspname = 'public'
ORDER BY tabela, tipo DESC, indice;


-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AUDITORIA — os blocos abaixo procuram PROBLEMAS.                   ║
-- ║ O ideal é que a maioria retorne ZERO linhas.                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════
-- 6. TABELAS SEM PRIMARY KEY
--    Impede replicação lógica, dificulta UPDATE/DELETE seguro e
--    normalmente indica tabela criada às pressas.
-- ════════════════════════════════════════════════════════════════════
SELECT c.relname AS tabela_sem_pk,
       c.reltuples::bigint AS linhas_estimadas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.oid AND i.indisprimary
  )
ORDER BY c.reltuples DESC;


-- ════════════════════════════════════════════════════════════════════
-- 7. FOREIGN KEYS SEM ÍNDICE  ⚠ maior causa de lentidão silenciosa
--    Sem índice na coluna filha, todo DELETE/UPDATE no pai faz
--    varredura completa da tabela filha.
--    (Heurística: verifica se a 1ª coluna da FK lidera algum índice.)
-- ════════════════════════════════════════════════════════════════════
SELECT
  con.conrelid::regclass::text  AS tabela_filha,
  con.conname                   AS fk,
  pg_get_constraintdef(con.oid) AS definicao,
  pg_size_pretty(
    pg_total_relation_size(con.conrelid)
  )                             AS tamanho_tabela
FROM pg_constraint con
JOIN pg_class     c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname  = 'public'
  AND con.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = con.conrelid
      AND i.indkey[0] = con.conkey[1]
  )
ORDER BY pg_total_relation_size(con.conrelid) DESC;


-- ════════════════════════════════════════════════════════════════════
-- 8. ÍNDICES DUPLICADOS / REDUNDANTES
--    Dois índices com a mesma assinatura: um deles é peso morto
--    (custa escrita e espaço sem ganho de leitura).
-- ════════════════════════════════════════════════════════════════════
WITH defs AS (
  SELECT
    i.indrelid::regclass::text AS tabela,
    ic.relname                 AS indice,
    regexp_replace(
      pg_get_indexdef(i.indexrelid),
      '^CREATE (UNIQUE )?INDEX \S+', 'IDX'
    )                          AS assinatura
  FROM pg_index i
  JOIN pg_class     ic ON ic.oid = i.indexrelid
  JOIN pg_class     tc ON tc.oid = i.indrelid
  JOIN pg_namespace n  ON n.oid  = tc.relnamespace
  WHERE n.nspname = 'public'
)
SELECT tabela,
       count(*)              AS quantidade,
       array_agg(indice)     AS indices_equivalentes,
       assinatura
FROM defs
GROUP BY tabela, assinatura
HAVING count(*) > 1
ORDER BY tabela;


-- ════════════════════════════════════════════════════════════════════
-- 9. ÍNDICES NUNCA USADOS
--    ⚠ Leia com cuidado: as estatísticas contam desde o último
--    restart/reset. Índice novo ou usado só em rotina mensal aparece
--    aqui sem ser inútil. PK e UNIQUE são excluídos (servem de
--    restrição, não só de performance).
-- ════════════════════════════════════════════════════════════════════
SELECT
  s.relname                                      AS tabela,
  s.indexrelname                                 AS indice,
  s.idx_scan                                     AS vezes_usado,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS tamanho
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.idx_scan = 0
  AND NOT i.indisprimary
  AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;


-- ════════════════════════════════════════════════════════════════════
-- 10. INCONSISTÊNCIA DE TIPOS NO MESMO NOME DE COLUNA
--     Ex.: product_code como varchar(20) numa tabela e text noutra.
--     É a origem clássica de JOIN lento e comparação que falha.
-- ════════════════════════════════════════════════════════════════════
SELECT
  column_name                                   AS coluna,
  count(DISTINCT data_type
        || COALESCE(character_maximum_length::text, ''))  AS variacoes,
  string_agg(DISTINCT
    table_name || ': ' || data_type
      || COALESCE('(' || character_maximum_length || ')', ''),
    '  |  ' ORDER BY table_name || ': ' || data_type
      || COALESCE('(' || character_maximum_length || ')', '')
  )                                             AS onde
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY column_name
HAVING count(DISTINCT data_type
             || COALESCE(character_maximum_length::text, '')) > 1
ORDER BY variacoes DESC, coluna;


-- ════════════════════════════════════════════════════════════════════
-- 11. TABELAS QUE NUNCA SOFRERAM VACUUM/ANALYZE
--     Sem ANALYZE o planejador trabalha com estatística velha e
--     escolhe planos ruins.
-- ════════════════════════════════════════════════════════════════════
SELECT
  relname                  AS tabela,
  n_live_tup               AS linhas_vivas,
  n_dead_tup               AS linhas_mortas,
  CASE WHEN n_live_tup > 0
       THEN round(100.0 * n_dead_tup / n_live_tup, 1)
       ELSE 0 END          AS pct_morto,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;


-- ════════════════════════════════════════════════════════════════════
-- 12. SEQUÊNCIAS PERTO DO LIMITE
--     Um integer estoura em 2.147.483.647. Detectar antes é barato.
-- ════════════════════════════════════════════════════════════════════
SELECT
  schemaname || '.' || sequencename          AS sequencia,
  last_value,
  max_value,
  CASE WHEN max_value > 0
       THEN round(100.0 * COALESCE(last_value,0) / max_value, 4)
       ELSE 0 END                            AS pct_consumido,
  data_type
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY pct_consumido DESC NULLS LAST;


-- ════════════════════════════════════════════════════════════════════
-- 13. TRIGGERS ATIVOS
--     Importante neste ERP: productsStockLots tem trigger que
--     recalcula productsStock.stock_qty automaticamente.
-- ════════════════════════════════════════════════════════════════════
SELECT
  c.relname          AS tabela,
  t.tgname           AS trigger_nome,
  p.proname          AS funcao,
  CASE t.tgenabled
    WHEN 'O' THEN 'ativo'
    WHEN 'D' THEN 'DESABILITADO'
    WHEN 'R' THEN 'replica'
    WHEN 'A' THEN 'always'
  END                AS estado,
  pg_get_triggerdef(t.oid) AS definicao
FROM pg_trigger   t
JOIN pg_class     c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc      p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;


-- ════════════════════════════════════════════════════════════════════
-- 14. VIEWS E MATERIALIZED VIEWS
-- ════════════════════════════════════════════════════════════════════
SELECT
  c.relname AS nome,
  CASE c.relkind WHEN 'v' THEN 'VIEW'
                 WHEN 'm' THEN 'MATERIALIZED VIEW' END AS tipo,
  pg_get_viewdef(c.oid, true) AS definicao
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
ORDER BY tipo, nome;


-- ════════════════════════════════════════════════════════════════════
-- 15. GERADOR DE DDL — monta o CREATE TABLE aproximado de cada tabela
--     Útil para versionar no repositório (docs/database/).
--     Não inclui FK/CHECK; combine com o bloco 4.
-- ════════════════════════════════════════════════════════════════════
SELECT
  c.relname AS tabela,
  'CREATE TABLE public.' || quote_ident(c.relname) || E' (\n'
  || string_agg(
       '    ' || quote_ident(a.attname) || ' '
       || format_type(a.atttypid, a.atttypmod)
       || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
       || COALESCE(' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid), ''),
       E',\n' ORDER BY a.attnum
     )
  || E'\n);' AS ddl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef ad
  ON ad.adrelid = c.oid AND ad.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attnum > 0
  AND NOT a.attisdropped
GROUP BY c.relname
ORDER BY c.relname;
