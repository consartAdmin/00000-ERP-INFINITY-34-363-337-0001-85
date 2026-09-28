-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2026-09-25 — Nova tabela de Pendências do Kanban                      ║
-- ║ Cria "ordersKanbanPendingItems" (product_code + barcode_id)          ║
-- ║ - Substitui "ordersKanbanPendings" (mantida intacta como backup)     ║
-- ║ - Copia as pendências existentes preservando pending_id              ║
-- ║ - barcode_id: unidade padrão ativa do produto em "productsBarCode"   ║
-- ║ - Aditivo e idempotente: pode ser executado mais de uma vez          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1) Tabela
CREATE TABLE IF NOT EXISTS public."ordersKanbanPendingItems" (
  pending_id   bigserial    PRIMARY KEY,
  card_id      integer      NOT NULL,
  product_code varchar(50)  NOT NULL,
  barcode_id   bigint,
  quantity     integer      NOT NULL,
  note         text,
  status       varchar(20)  NOT NULL DEFAULT 'aberto',
  created_at   timestamp    NOT NULL DEFAULT now(),
  updated_at   timestamp    NOT NULL DEFAULT now(),

  CONSTRAINT orderskanbanpendingitems_status_chk
    CHECK (status IN ('aberto', 'concluido')),

  -- card excluído → pendências excluídas
  CONSTRAINT fk_orderskanban_pendingitems_card
    FOREIGN KEY (card_id)
    REFERENCES public."ordersKanbanCards"(card_id)
    ON DELETE CASCADE,

  -- código de barras excluído → pendência permanece sem unidade
  CONSTRAINT fk_orderskanban_pendingitems_barcode
    FOREIGN KEY (barcode_id)
    REFERENCES public."productsBarCode"(barcode_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orderskanban_pendingitems_card
  ON public."ordersKanbanPendingItems" (card_id);

CREATE INDEX IF NOT EXISTS idx_orderskanban_pendingitems_status
  ON public."ordersKanbanPendingItems" (status);

CREATE INDEX IF NOT EXISTS idx_orderskanban_pendingitems_product
  ON public."ordersKanbanPendingItems" (product_code);

COMMENT ON TABLE public."ordersKanbanPendingItems" IS
  'Pendências dos cards do Kanban de pedidos (produto + unidade via productsBarCode).';
COMMENT ON COLUMN public."ordersKanbanPendingItems".barcode_id IS
  'productsBarCode.barcode_id — define a unidade (unit/fator) da pendência.';

-- 2) Copia as pendências antigas
--    - product_id → products.product_code (linhas sem produto válido não são copiadas)
--    - description antiga é anexada à note
--    - barcode_id: unidade informada (se existir coluna unit), senão a padrão,
--      senão a de menor fator
INSERT INTO public."ordersKanbanPendingItems" (
  pending_id, card_id, product_code, barcode_id, quantity, note, status, created_at, updated_at
)
SELECT
  o.pending_id,
  o.card_id,
  pr.product_code,
  (
    SELECT b.barcode_id
    FROM public."productsBarCode" b
    WHERE b.product_code = pr.product_code
      AND b.is_active IS TRUE
    ORDER BY
      (upper(b.unit) = upper(to_jsonb(o) ->> 'unit')) DESC NULLS LAST,
      b.standard DESC NULLS LAST,
      b.fator ASC NULLS LAST,
      b.barcode_id
    LIMIT 1
  ),
  COALESCE(o.quantity, 0),
  NULLIF(concat_ws(' | ', NULLIF(trim(o.note), ''), NULLIF(trim(o.description), '')), ''),
  COALESCE(o.status, 'aberto'),
  COALESCE(o.created_at, now()),
  COALESCE(o.updated_at, o.created_at, now())
FROM public."ordersKanbanPendings" o
JOIN public.products pr
  ON pr.product_id = o.product_id
JOIN public."ordersKanbanCards" k
  ON k.card_id = o.card_id
ON CONFLICT (pending_id) DO NOTHING;

-- 3) Sequência continua após o maior pending_id copiado
SELECT setval(
  pg_get_serial_sequence('public."ordersKanbanPendingItems"', 'pending_id'),
  COALESCE((SELECT max(pending_id) FROM public."ordersKanbanPendingItems"), 1),
  (SELECT count(*) > 0 FROM public."ordersKanbanPendingItems")
);

COMMIT;

-- Conferência (opcional):
-- SELECT
--   (SELECT count(*) FROM public."ordersKanbanPendings")     AS antigas,
--   (SELECT count(*) FROM public."ordersKanbanPendingItems") AS novas;
--
-- Pendências antigas que NÃO foram copiadas (produto/card inexistente):
-- SELECT o.*
-- FROM public."ordersKanbanPendings" o
-- LEFT JOIN public."ordersKanbanPendingItems" n ON n.pending_id = o.pending_id
-- WHERE n.pending_id IS NULL;
