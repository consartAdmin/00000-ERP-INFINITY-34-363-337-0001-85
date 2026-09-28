-- ============================================================
-- budgetsShipping — Frete e transporte dos orçamentos
-- CONSART ERP | PostgreSQL
--
-- Dependências:
--   public.budgets (budget_id)
--   public.transporters (transporter_id)
-- ============================================================


CREATE TABLE public."budgetsShipping" (
    budget_shipping_id SERIAL,
    budget_id          INTEGER NOT NULL,

    freight_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
    freight_mode       SMALLINT NOT NULL DEFAULT 9,

    carrier_name       VARCHAR(150),
    carrier_cnpj_cpf   VARCHAR(20),
    carrier_ie         VARCHAR(30),
    carrier_address    VARCHAR(200),
    carrier_number     VARCHAR(20),
    carrier_complement VARCHAR(100),
    carrier_district   VARCHAR(100),
    carrier_city       VARCHAR(100),
    carrier_state      CHAR(2),
    carrier_zipcode    VARCHAR(10),

    vehicle_plate      VARCHAR(10),
    vehicle_state      CHAR(2),
    vehicle_rntc       VARCHAR(30),

    volumes            INTEGER DEFAULT 0,
    volume_species     VARCHAR(60),
    volume_brand       VARCHAR(60),
    volume_numbering   VARCHAR(60),

    gross_weight       NUMERIC(14,3) DEFAULT 0,
    net_weight         NUMERIC(14,3) DEFAULT 0,

    transporter_id     INTEGER,

    notes              TEXT,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),



    CONSTRAINT "budgetsShipping_pkey"
        PRIMARY KEY (budget_shipping_id),

    CONSTRAINT uq_budget_shipping
        UNIQUE (budget_id),

    CONSTRAINT fk_budget_shipping_budget
        FOREIGN KEY (budget_id)
        REFERENCES public.budgets (budget_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT budgets_shipping_transporter_id_fkey
        FOREIGN KEY (transporter_id)
        REFERENCES public.transporters (transporter_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

-- ============================================================
-- Índices
-- ============================================================

CREATE INDEX idx_budgets_shipping_transporter_id
    ON public."budgetsShipping" (transporter_id);

CREATE INDEX idx_budgetshipping_active
    ON public."budgetsShipping" (is_active);

CREATE INDEX idx_budgetshipping_budget
    ON public."budgetsShipping" (budget_id);

CREATE INDEX idx_budgetshipping_document
    ON public."budgetsShipping" (carrier_cnpj_cpf);

-- ============================================================
-- Referência inversa: orçamento → dados de transporte
-- Requer que budgets.budget_shipping_id já exista.
-- ============================================================

ALTER TABLE public.budgets
    ADD CONSTRAINT fk_budgets_shipping
    FOREIGN KEY (budget_shipping_id)
    REFERENCES public."budgetsShipping" (budget_shipping_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- ============================================================
-- Trigger: preenchimento dos dados da transportadora
-- Executar após criar a função indicada.
-- ============================================================

CREATE TRIGGER trg_budgets_shipping_fill_carrier
    BEFORE INSERT OR UPDATE
    ON public."budgetsShipping"
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_budgets_shipping_fill_carrier();

SELECT pg_get_functiondef(
    'public.fn_budgets_shipping_fill_carrier()'::regprocedure
);