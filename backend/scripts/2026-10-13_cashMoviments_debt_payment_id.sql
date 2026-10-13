-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2026-10-13 — Vínculo Pagamento de Dívida → Caixa                      ║
-- ║ Adiciona "cashMoviments".debt_payment_id                              ║
-- ║ - 1 movimentação (SAÍDA) por pagamento de dívida                     ║
-- ║ - O servidor também aplica isto sozinho no 1º pagamento               ║
-- ║   (debtPaymentsCashMovement.repository.js); rodar à mão é opcional    ║
-- ║ - Aditivo e idempotente: pode ser executado mais de uma vez          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

ALTER TABLE public."cashMoviments"
  ADD COLUMN IF NOT EXISTS debt_payment_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_cashmoviments_debt_payment'
  ) THEN
    ALTER TABLE public."cashMoviments"
      ADD CONSTRAINT fk_cashmoviments_debt_payment
      FOREIGN KEY (debt_payment_id)
      REFERENCES public.debt_payments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cashmoviments_debt_payment_id
  ON public."cashMoviments" (debt_payment_id)
  WHERE debt_payment_id IS NOT NULL;

COMMENT ON COLUMN public."cashMoviments".debt_payment_id IS
  'Pagamento de dívida (debt_payments) que originou esta SAÍDA.';

COMMIT;
