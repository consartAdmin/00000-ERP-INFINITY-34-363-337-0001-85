/* ╔══════════════════════════════════════════════════════════════════════╗
║ FILE: create_table_budgetsPayments.sql                               ║
║ MODULE: Budgets Payments                                             ║
║ DESCRIPTION: DDL de public."budgetsPayments"                         ║
║ CONSART ERP · PostgreSQL                                             ║
║                                                                      ║
║ Espelha catalog_schema.budgetsPayments.js.                           ║
║ Depende de: public."paymentMethods", public."bankAccounts"           ║
║ Referenciada por: public."budgetsPaymentInstallments"                ║
║   (fk_budgetspaymentinstallments_payment, ON DELETE CASCADE —        ║
║    criada no script daquela tabela)                                  ║
╚══════════════════════════════════════════════════════════════════════╝ */

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- Sequence
-- ────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public."budgetsPayments_budget_payment_id_seq"
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- ────────────────────────────────────────────────────────────────────────
-- Tabela
-- ────────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public."budgetsPayments" (
  budget_payment_id    bigint                   NOT NULL
                       DEFAULT nextval('public."budgetsPayments_budget_payment_id_seq"'::regclass),
  budget_id            bigint                   NOT NULL,
  payment_method_id    integer                  NOT NULL,
  amount               numeric(14,2)            NOT NULL DEFAULT 0,
  notes                character varying(255),
  created_at           timestamp with time zone NOT NULL DEFAULT now(),
  updated_at           timestamp with time zone NOT NULL DEFAULT now(),
  manual_due_date      date,
  bank_account_id      bigint,
  collection_provider  character varying(30)    NOT NULL DEFAULT 'NO_INTEGRATION'::character varying,
  boleto_mode          character varying(20)    NOT NULL DEFAULT 'NONE'::character varying,

  CONSTRAINT "budgetsPayments_pkey"
    PRIMARY KEY (budget_payment_id),

  CONSTRAINT chk_budgets_payments_boleto_mode
    CHECK (boleto_mode::text = ANY (ARRAY[
      'AUTOMATIC'::character varying,
      'MANUAL'::character varying,
      'NONE'::character varying
    ]::text[])),

  CONSTRAINT chk_budgets_payments_collection_provider
    CHECK (collection_provider::text = ANY (ARRAY[
      'ASAAS'::character varying,
      'MANUAL'::character varying,
      'OTHER_API'::character varying,
      'NO_INTEGRATION'::character varying
    ]::text[])),

  CONSTRAINT fk_budgets_payments_bank_account
    FOREIGN KEY (bank_account_id)
    REFERENCES public."bankAccounts" (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  CONSTRAINT fk_budgetspayments_method
    FOREIGN KEY (payment_method_id)
    REFERENCES public."paymentMethods" ("paymentMethods_id")
);

ALTER SEQUENCE public."budgetsPayments_budget_payment_id_seq"
  OWNED BY public."budgetsPayments".budget_payment_id;

-- ────────────────────────────────────────────────────────────────────────
-- Índices
-- ────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_budgets_payments_bank_account_id
  ON public."budgetsPayments" USING btree (bank_account_id);

CREATE INDEX IF NOT EXISTS idx_budgetspayments_budget_id
  ON public."budgetsPayments" USING btree (budget_id);

CREATE INDEX IF NOT EXISTS idx_budgetspayments_payment_method_id
  ON public."budgetsPayments" USING btree (payment_method_id);

-- ────────────────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at_budgets_payments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budgetspayments_updated_at ON public."budgetsPayments";

CREATE TRIGGER trg_budgetspayments_updated_at
  BEFORE UPDATE ON public."budgetsPayments"
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_budgets_payments();

COMMIT;