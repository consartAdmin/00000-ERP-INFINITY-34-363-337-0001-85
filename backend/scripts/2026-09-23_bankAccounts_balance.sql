-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2026-09-23 — Controle de Saldo das Contas Bancárias                   ║
-- ║                                                                      ║
-- ║ 1) "bankAccountsBalance": conferências de saldo (checkpoints)         ║
-- ║    Cada linha = "no fim do dia X, o extrato do banco mostrava R$ Y"   ║
-- ║    system_balance = saldo que o ERP calculava na mesma data          ║
-- ║    difference     = balance − system_balance (divergência)           ║
-- ║                                                                      ║
-- ║ 2) "cashMoviments".bank_account_id (vínculo por ID, não por nome)     ║
-- ║ 3) Preenche bank_account_id das movimentações existentes pelo nome   ║
-- ║    NUBANK / Nubank / Nubank 251837891-5 → Nubank (id 2)               ║
-- ║    ASAAS / Banco Asaas Integração        → Banco Asaas Integração (1) ║
-- ║    CAIXA / ESPÉCIE / BANCO DO BRASIL     → sem vínculo (não somam)    ║
-- ║                                                                      ║
-- ║ Saldo atual = balance da última conferência                          ║
-- ║             + ENTRADAS − SAÍDAS ativas APÓS a data da conferência    ║
-- ║               (movement_date >= balance_date + 1 dia)                 ║
-- ║                                                                      ║
-- ║ Aditivo e idempotente: pode ser executado mais de uma vez            ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1) Conferências de saldo
CREATE TABLE IF NOT EXISTS public."bankAccountsBalance" (
  id               bigserial PRIMARY KEY,
  bank_account_id  bigint NOT NULL
                   REFERENCES public."bankAccounts"(id) ON DELETE CASCADE,
  balance_date     date NOT NULL,
  balance          numeric(15,2) NOT NULL,
  system_balance   numeric(15,2),
  difference       numeric(15,2)
                   GENERATED ALWAYS AS (balance - system_balance) STORED,
  notes            text,
  created_by       varchar(150),
  created_at       timestamp without time zone NOT NULL DEFAULT now(),
  updated_at       timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT ux_bankaccountsbalance_account_date
    UNIQUE (bank_account_id, balance_date)
);

COMMENT ON TABLE public."bankAccountsBalance" IS
  'Conferências de saldo: saldo do extrato bancário no FIM do dia balance_date.';
COMMENT ON COLUMN public."bankAccountsBalance".balance IS
  'Saldo real informado (extrato/app do banco) no fim do dia balance_date.';
COMMENT ON COLUMN public."bankAccountsBalance".system_balance IS
  'Saldo calculado pelo ERP para a mesma data no momento da conferência (NULL na primeira).';
COMMENT ON COLUMN public."bankAccountsBalance".difference IS
  'balance − system_balance. Diferente de zero indica movimentação faltando ou duplicada.';

CREATE INDEX IF NOT EXISTS idx_bankaccountsbalance_account_date
  ON public."bankAccountsBalance" (bank_account_id, balance_date DESC);

-- 2) Vínculo movimentação → conta bancária
ALTER TABLE public."cashMoviments"
  ADD COLUMN IF NOT EXISTS bank_account_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_cashmoviments_bank_account'
  ) THEN
    ALTER TABLE public."cashMoviments"
      ADD CONSTRAINT fk_cashmoviments_bank_account
      FOREIGN KEY (bank_account_id)
      REFERENCES public."bankAccounts"(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cashmoviments_bank_account_date
  ON public."cashMoviments" (bank_account_id, movement_date);

COMMENT ON COLUMN public."cashMoviments".bank_account_id IS
  'Conta bancária da movimentação (usada no saldo das contas).';

-- 3) Preenche as movimentações existentes pelo nome gravado em cash_account
UPDATE public."cashMoviments"
SET bank_account_id = 2
WHERE bank_account_id IS NULL
  AND UPPER(TRIM(cash_account)) IN ('NUBANK', 'NUBANK 251837891-5');

UPDATE public."cashMoviments"
SET bank_account_id = 1
WHERE bank_account_id IS NULL
  AND UPPER(TRIM(cash_account)) IN ('ASAAS', 'BANCO ASAAS INTEGRAÇÃO');

COMMIT;

-- Conferência: quantidade de movimentações por conta vinculada
-- Esperado: 1 (Asaas) = 3 | 2 (Nubank) = 1647 | NULL = 121
SELECT
  bank_account_id,
  COUNT(*) AS movimentacoes
FROM public."cashMoviments"
GROUP BY bank_account_id
ORDER BY bank_account_id NULLS LAST;
