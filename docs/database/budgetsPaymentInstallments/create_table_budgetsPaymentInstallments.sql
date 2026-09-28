/* ╔══════════════════════════════════════════════════════════════════════╗
║ FILE: create_table_budgetsPaymentInstallments.sql                    ║
║ MODULE: Budget Payment Installments                                  ║
║ DESCRIPTION: DDL de public."budgetsPaymentInstallments"              ║
║ CONSART ERP · PostgreSQL                                             ║
║                                                                      ║
║ Espelha catalog_schema.budgetsPaymentInstallments.js.                ║
║ Depende de: public."budgetsPayments"                                 ║
║   (rodar create_table_budgetsPayments.sql antes)                     ║
╚══════════════════════════════════════════════════════════════════════╝ */

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- Sequence
-- ────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public."budgetsPaymentInstallments_budget_payment_installment_id_seq"
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- ────────────────────────────────────────────────────────────────────────
-- Tabela
-- ────────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public."budgetsPaymentInstallments" (
  budget_payment_installment_id  bigint                   NOT NULL
                                 DEFAULT nextval('public."budgetsPaymentInstallments_budget_payment_installment_id_seq"'::regclass),
  budget_payment_id              bigint                   NOT NULL,
  budget_id                      bigint                   NOT NULL,
  installment_number             integer                  NOT NULL,
  due_date                       date,
  amount                         numeric(14,2)            NOT NULL DEFAULT 0,
  status                         character varying(30)    NOT NULL DEFAULT 'PENDENTE'::character varying,
  paid_amount                    numeric(14,2)            NOT NULL DEFAULT 0,
  paid_at                        timestamp with time zone,
  notes                          character varying(255),
  created_at                     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                     timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "budgetsPaymentInstallments_pkey"
    PRIMARY KEY (budget_payment_installment_id),

  CONSTRAINT ck_budgetspaymentinstallments_amount
    CHECK (amount >= 0::numeric),

  CONSTRAINT ck_budgetspaymentinstallments_paid_amount
    CHECK (paid_amount >= 0::numeric),

  CONSTRAINT ck_budgetspaymentinstallments_status
    CHECK (status::text = ANY (ARRAY[
      'PENDENTE'::character varying::text,
      'PAGO'::character varying::text,
      'PARCIAL'::character varying::text,
      'CANCELADO'::character varying::text
    ])),

  CONSTRAINT fk_budgetspaymentinstallments_payment
    FOREIGN KEY (budget_payment_id)
    REFERENCES public."budgetsPayments" (budget_payment_id)
    ON DELETE CASCADE
);

ALTER SEQUENCE public."budgetsPaymentInstallments_budget_payment_installment_id_seq"
  OWNED BY public."budgetsPaymentInstallments".budget_payment_installment_id;

-- ────────────────────────────────────────────────────────────────────────
-- Índices
-- ────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bpi_budget_id
  ON public."budgetsPaymentInstallments" USING btree (budget_id);

CREATE INDEX IF NOT EXISTS idx_bpi_budget_payment_id
  ON public."budgetsPaymentInstallments" USING btree (budget_payment_id);

CREATE INDEX IF NOT EXISTS idx_bpi_due_date
  ON public."budgetsPaymentInstallments" USING btree (due_date);

CREATE INDEX IF NOT EXISTS idx_bpi_status
  ON public."budgetsPaymentInstallments" USING btree (status);

-- Índice único (não constraint), como no banco atual: uma parcela N por pagamento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bpi_payment_installment_number
  ON public."budgetsPaymentInstallments" USING btree (budget_payment_id, installment_number);

-- ────────────────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at_budgets_payment_installments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budgetspaymentinstallments_updated_at ON public."budgetsPaymentInstallments";

CREATE TRIGGER trg_budgetspaymentinstallments_updated_at
  BEFORE UPDATE ON public."budgetsPaymentInstallments"
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_budgets_payment_installments();

COMMIT;