-- ============================================================================
-- CONSART ERP
-- Backfill seguro de inboundInvoiceItems.lot_id para histórico STOCK_WITH_LOT
-- ============================================================================
--
-- Objetivo:
--   Corrigir itens de NF-e de entrada antigos que foram gravados com lot_id NULL
--   antes da resolução automática de lotes existir no backend.
--
-- Estratégia segura:
--   1) localizar o productsStock pelo product_code;
--   2) respeitar product_grade_id quando o item possui grade;
--   3) preferir lote cuja origem nfe_key + nfe_item_seq seja a mesma;
--   4) caso contrário, usar somente o lote ativo chamado "LOTE PADRÃO";
--   5) não altera itens que já possuem lot_id.
--
-- O script é idempotente.
-- ============================================================================

BEGIN;

WITH candidates AS (
  SELECT
    ii.inbound_item_id,
    lot.lot_id,
    ROW_NUMBER() OVER (
      PARTITION BY ii.inbound_item_id
      ORDER BY
        CASE
          WHEN lot.nfe_key IS NOT DISTINCT FROM ii.nfe_key
           AND lot.nfe_item_seq IS NOT DISTINCT FROM ii.nfe_item_seq
           AND ii.nfe_key IS NOT NULL
           AND ii.nfe_item_seq IS NOT NULL
          THEN 0
          WHEN LOWER(BTRIM(lot.lot_code)) = LOWER(BTRIM('LOTE PADRÃO'))
          THEN 1
          ELSE 2
        END,
        lot.lot_id DESC
    ) AS preference_order
  FROM public."inboundInvoiceItems" ii
  JOIN public.products p
    ON TRIM(p.product_code) = TRIM(ii.product_code)
  JOIN public."productsStockLots" lot
    ON lot.product_stock_id = p.product_stock_id
   AND COALESCE(lot.is_active, TRUE) = TRUE
   AND lot.deleted_at IS NULL
   AND (
        ii.product_grade_id IS NULL
        OR lot.product_grade_id = ii.product_grade_id
   )
  WHERE ii.lot_id IS NULL
    AND NULLIF(TRIM(ii.product_code), '') IS NOT NULL
    AND (
      (
        lot.nfe_key IS NOT DISTINCT FROM ii.nfe_key
        AND lot.nfe_item_seq IS NOT DISTINCT FROM ii.nfe_item_seq
        AND ii.nfe_key IS NOT NULL
        AND ii.nfe_item_seq IS NOT NULL
      )
      OR LOWER(BTRIM(lot.lot_code)) = LOWER(BTRIM('LOTE PADRÃO'))
    )
),
selected AS (
  SELECT inbound_item_id, lot_id
  FROM candidates
  WHERE preference_order = 1
)
UPDATE public."inboundInvoiceItems" ii
SET
  lot_id = selected.lot_id,
  updated_at = NOW()
FROM selected
WHERE ii.inbound_item_id = selected.inbound_item_id
  AND ii.lot_id IS NULL;

-- Diagnóstico após backfill: itens ainda sem lote.
SELECT
  ii.inbound_item_id,
  ii.inbound_id,
  ii.product_code,
  ii.product_grade_id,
  ii.nfe_key,
  ii.nfe_item_seq,
  ii.icms_cst,
  ii.icms_st_base,
  ii.icms_st_rate,
  ii.icms_st_value
FROM public."inboundInvoiceItems" ii
WHERE ii.lot_id IS NULL
  AND NULLIF(TRIM(ii.product_code), '') IS NOT NULL
ORDER BY ii.inbound_id DESC, ii.inbound_item_id DESC;

COMMIT;
