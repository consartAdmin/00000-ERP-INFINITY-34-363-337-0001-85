-- Padrões financeiros do cliente (Plano de Contas / Categoria / Subcategoria)
-- usados para pré-preencher a Movimentação de Caixa ao selecionar o cliente.
BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_chart_account_id    BIGINT,
  ADD COLUMN IF NOT EXISTS default_cash_category_id    BIGINT,
  ADD COLUMN IF NOT EXISTS default_cash_subcategory_id BIGINT;

COMMIT;
