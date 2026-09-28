-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2026-09-23 — Vínculo Contas a Receber → Caixa                         ║
-- ║ Adiciona "cashMoviments".accounts_receivable_id                       ║
-- ║ - 1 movimentação de caixa por conta a receber (índice único parcial) ║
-- ║ - Evita duplicar ENTRADA a cada sincronização do Asaas               ║
-- ║ - Aditivo e idempotente: pode ser executado mais de uma vez          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1) Coluna de vínculo (nula para movimentações manuais/antigas)
ALTER TABLE public."cashMoviments"
  ADD COLUMN IF NOT EXISTS accounts_receivable_id bigint;

-- 2) Chave estrangeira: se a conta a receber for excluída, o caixa permanece
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_cashmoviments_accounts_receivable'
  ) THEN
    ALTER TABLE public."cashMoviments"
      ADD CONSTRAINT fk_cashmoviments_accounts_receivable
      FOREIGN KEY (accounts_receivable_id)
      REFERENCES public."accountsReceivable"(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3) No máximo uma movimentação por conta a receber
--    (estorno desativa com is_active = false; novo recebimento reativa a mesma linha)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cashmoviments_accounts_receivable_id
  ON public."cashMoviments" (accounts_receivable_id)
  WHERE accounts_receivable_id IS NOT NULL;

COMMENT ON COLUMN public."cashMoviments".accounts_receivable_id IS
  'Conta a receber que originou esta ENTRADA (recebimento manual ou Asaas).';

COMMIT;

-- Conferência (opcional):
-- \d public."cashMoviments"
