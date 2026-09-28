BEGIN;

-- ============================================================
-- 2. Recreate the table
-- ============================================================

CREATE TABLE public."budgetsNfeAttemptItems" (
    attempt_item_id BIGINT GENERATED ALWAYS AS IDENTITY,
    attempt_id      BIGINT NOT NULL,
    budget_item_id  BIGINT,
    item_number     INTEGER NOT NULL,

-- Product identification
product_id BIGINT,
product_code VARCHAR(60) NOT NULL,
barcode VARCHAR(30),
description VARCHAR(500) NOT NULL,

-- Fiscal references
products_fiscal_id BIGINT,
fiscal_classification_id INTEGER,
fiscal_profile_id INTEGER,
fiscal_version INTEGER,
fiscal_effective_from TIMESTAMPTZ,
fiscal_effective_to TIMESTAMPTZ,
fiscal_source_system VARCHAR(60),
fiscal_source_reference VARCHAR(120),

-- Fiscal classification
classification_name VARCHAR(150),
classification_description TEXT,
ncm_code VARCHAR(10),
ncm_description TEXT,
ex_tipi VARCHAR(3),
cest_code VARCHAR(10),
cest_description TEXT,

-- Units and quantities
commercial_unit VARCHAR(10),
taxable_unit VARCHAR(10),
is_unit VARCHAR(6),
quantity NUMERIC(18, 6) NOT NULL DEFAULT 0,
taxable_quantity NUMERIC(18, 6),
unit_price NUMERIC(18, 10) NOT NULL DEFAULT 0,
taxable_unit_price NUMERIC(18, 10),

-- Item totals
gross_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
freight_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
insurance_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
other_expenses_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
net_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
included_in_invoice_total BOOLEAN NOT NULL DEFAULT TRUE,

-- Stock and lot
product_stock_id BIGINT,
lot_id BIGINT,
lot_number VARCHAR(100),
manufacturing_date DATE,
expiration_date DATE,

-- Fiscal profile
fiscal_profile_name VARCHAR(100),
fiscal_profile_description TEXT,

-- ICMS
origin_code VARCHAR(2),
icms_cst VARCHAR(3),
icms_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
cfop_entry VARCHAR(10),
cfop_exit VARCHAR(10),
cfop_used VARCHAR(10),

-- PIS
pis_cst VARCHAR(3),
pis_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,

-- COFINS
cofins_cst VARCHAR(3),
cofins_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
benefit_code VARCHAR(20),

-- ICMS calculation
icms_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
icms_base_reduction_pct NUMERIC(9, 4) NOT NULL DEFAULT 0,
icms_effective_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
icms_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- ICMS-ST
icms_st_modality VARCHAR(2),
icms_st_mva_pct NUMERIC(9, 4) NOT NULL DEFAULT 0,
icms_st_base_reduction_pct NUMERIC(9, 4) NOT NULL DEFAULT 0,
icms_st_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
icms_st_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
icms_st_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
icms_st_retained_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
icms_st_retained_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
icms_st_retained_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- FCP
fcp_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
fcp_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
fcp_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
fcp_st_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
fcp_st_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
fcp_st_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- PIS calculation
pis_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
pis_effective_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
pis_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- COFINS calculation
cofins_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
cofins_effective_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
cofins_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- Selective Tax (IS)
is_cst VARCHAR(3),
is_classification VARCHAR(10),
is_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
is_specific_rate NUMERIC(15, 6) NOT NULL DEFAULT 0,
is_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
is_quantity NUMERIC(18, 6) NOT NULL DEFAULT 0,
is_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- IBS/CBS
ibscbs_cst VARCHAR(3),
ibscbs_classification VARCHAR(6),
ibs_uf_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
ibs_municipal_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
cbs_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
donation_indicator SMALLINT NOT NULL DEFAULT 1,
ibscbs_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
ibs_uf_effective_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
ibs_uf_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
ibs_municipal_effective_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
ibs_municipal_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
ibs_total_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
cbs_effective_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
cbs_value NUMERIC(18, 4) NOT NULL DEFAULT 0,

-- Snapshots
product_fiscal_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    classification_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    fiscal_profile_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    tax_reform_details      JSONB NOT NULL DEFAULT '{}'::JSONB,
    tax_calculation         JSONB NOT NULL DEFAULT '{}'::JSONB,
    budget_item_snapshot    JSONB NOT NULL DEFAULT '{}'::JSONB,
    provider_item_payload   JSONB NOT NULL DEFAULT '{}'::JSONB,

-- Stock application control
stock_applied_at TIMESTAMPTZ,
stock_applied_quantity NUMERIC(18, 6),
stock_reversed_at TIMESTAMPTZ,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

-- ========================================================
-- Constraints
-- ========================================================

CONSTRAINT "budgetsNfeAttemptItems_pkey" PRIMARY KEY (attempt_item_id),
CONSTRAINT "uq_budgetsNfeAttemptItems_number" UNIQUE (attempt_id, item_number),
CONSTRAINT "ck_budgetsNfeAttemptItems_donation" CHECK (donation_indicator IN (0, 1)),
CONSTRAINT "ck_budgetsNfeAttemptItems_item_number" CHECK (item_number > 0),
CONSTRAINT "ck_budgetsNfeAttemptItems_quantity" CHECK (quantity >= 0),
CONSTRAINT "ck_budgetsNfeAttemptItems_taxable_quantity" CHECK (
    taxable_quantity IS NULL
    OR taxable_quantity >= 0
),
CONSTRAINT "ck_budgetsNfeAttemptItems_unit_price" CHECK (unit_price >= 0),
CONSTRAINT "ck_budgetsNfeAttemptItems_values" CHECK (
    gross_total >= 0
    AND discount_amount >= 0
    AND freight_amount >= 0
    AND insurance_amount >= 0
    AND other_expenses_amount >= 0
    AND net_total >= 0
),
CONSTRAINT "ck_budgetsNfeAttemptItems_stock_applied_quantity" CHECK (
    stock_applied_quantity IS NULL
    OR stock_applied_quantity > 0
),
CONSTRAINT "ck_budgetsNfeAttemptItems_json" CHECK (
    JSONB_TYPEOF (product_fiscal_snapshot) = 'object'
    AND JSONB_TYPEOF (classification_snapshot) = 'object'
    AND JSONB_TYPEOF (fiscal_profile_snapshot) = 'object'
    AND JSONB_TYPEOF (tax_reform_details) = 'object'
    AND JSONB_TYPEOF (tax_calculation) = 'object'
    AND JSONB_TYPEOF (budget_item_snapshot) = 'object'
    AND JSONB_TYPEOF (provider_item_payload) = 'object'
),

-- ========================================================
-- Foreign keys
-- ========================================================

CONSTRAINT "fk_budgetsNfeAttemptItems_attempt"
        FOREIGN KEY (attempt_id)
        REFERENCES public."budgetsNfeAttempts" (attempt_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT "fk_budgetsNfeAttemptItems_classification"
        FOREIGN KEY (fiscal_classification_id)
        REFERENCES public.fiscal_classification_v2 (
            fiscal_classification_id
        )
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT "fk_budgetsNfeAttemptItems_product_fiscal"
        FOREIGN KEY (products_fiscal_id)
        REFERENCES public."productsFiscalV2" (
            products_fiscal_id
        )
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT "fk_budgetsNfeAttemptItems_profile"
        FOREIGN KEY (fiscal_profile_id)
        REFERENCES public.fiscal_profile_v2 (
            fiscal_profile_id
        )
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

-- ============================================================
-- 3. Recreate indexes
-- ============================================================

CREATE INDEX "idx_budgetsNfeAttemptItems_attempt"
    ON public."budgetsNfeAttemptItems" (attempt_id);

CREATE INDEX "idx_budgetsNfeAttemptItems_budget_item"
    ON public."budgetsNfeAttemptItems" (budget_item_id)
    WHERE budget_item_id IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_cfop"
    ON public."budgetsNfeAttemptItems" (cfop_used)
    WHERE cfop_used IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_classification"
    ON public."budgetsNfeAttemptItems" (fiscal_classification_id)
    WHERE fiscal_classification_id IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_ibscbs"
    ON public."budgetsNfeAttemptItems" (
        ibscbs_cst,
        ibscbs_classification
    );

CREATE INDEX "idx_budgetsNfeAttemptItems_lot"
    ON public."budgetsNfeAttemptItems" (lot_id)
    WHERE lot_id IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_ncm"
    ON public."budgetsNfeAttemptItems" (ncm_code)
    WHERE ncm_code IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_product_code"
    ON public."budgetsNfeAttemptItems" (product_code);

CREATE INDEX "idx_budgetsNfeAttemptItems_product_fiscal"
    ON public."budgetsNfeAttemptItems" (products_fiscal_id)
    WHERE products_fiscal_id IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_profile"
    ON public."budgetsNfeAttemptItems" (fiscal_profile_id)
    WHERE fiscal_profile_id IS NOT NULL;

CREATE INDEX "idx_budgetsNfeAttemptItems_stock_pending"
    ON public."budgetsNfeAttemptItems" (
        attempt_id,
        attempt_item_id
    )
    WHERE stock_applied_at IS NULL;

COMMIT;