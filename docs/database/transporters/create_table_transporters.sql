-----------------------------------------------------------------------
-- Create the transporters table
-- Mirrors the real schema (\d transporters)
-- Referenced by: "budgetsShipping", "transportersAttachments"
-----------------------------------------------------------------------

BEGIN;

-----------------------------------------------------------------------
-- Primary key sequence
-- (legacy name kept: the column was renamed from id → transporter_id)
-----------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.transporters_id_seq
    AS INTEGER
    START WITH 1
    INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.transporters (
    --------------------------------------------------------------------
    -- Identification
    --------------------------------------------------------------------
    transporter_id         INTEGER      NOT NULL DEFAULT nextval('public.transporters_id_seq'::regclass),

    trade_name             VARCHAR(200),
    legal_name             VARCHAR(200) NOT NULL,
    tax_id                 VARCHAR(20),
    cpf                    VARCHAR(14),

    --------------------------------------------------------------------
    -- Address
    --------------------------------------------------------------------
    postal_code            VARCHAR(15),
    street_type            VARCHAR(50),
    street_name            VARCHAR(255),
    street_number          VARCHAR(20),
    address_complement     VARCHAR(255),
    neighborhood           VARCHAR(100),
    city                   VARCHAR(100),
    state                  VARCHAR(2),
    ibge_location_id       VARCHAR(50),

    --------------------------------------------------------------------
    -- Contact
    --------------------------------------------------------------------
    contact_name           VARCHAR(150),
    phone_number           VARCHAR(50),
    mobile_number          VARCHAR(50),

    --------------------------------------------------------------------
    -- Fiscal registrations
    --------------------------------------------------------------------
    state_registration     VARCHAR(100),
    municipal_registration VARCHAR(100),
    rntrc                  VARCHAR(20),

    --------------------------------------------------------------------
    -- Additional information
    --------------------------------------------------------------------
    notes                  TEXT,
    is_active              BOOLEAN      DEFAULT TRUE,

    --------------------------------------------------------------------
    -- Audit
    --------------------------------------------------------------------
    created_at             TIMESTAMP    DEFAULT NOW(),
    updated_at             TIMESTAMP    DEFAULT NOW(),

    --------------------------------------------------------------------
    -- Primary key
    --------------------------------------------------------------------
    CONSTRAINT transporters_pkey PRIMARY KEY (transporter_id)
);

ALTER SEQUENCE public.transporters_id_seq
    OWNED BY public.transporters.transporter_id;

-----------------------------------------------------------------------
-- Search indexes
-----------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_transporters_cpf ON public.transporters (cpf);

CREATE INDEX IF NOT EXISTS idx_transporters_is_active ON public.transporters (is_active);

CREATE INDEX IF NOT EXISTS idx_transporters_legal_name ON public.transporters (legal_name);

CREATE INDEX IF NOT EXISTS idx_transporters_tax_id ON public.transporters (tax_id);

CREATE INDEX IF NOT EXISTS idx_transporters_trade_name ON public.transporters (trade_name);

-----------------------------------------------------------------------
-- Table and column documentation
-----------------------------------------------------------------------

COMMENT ON
TABLE public.transporters IS 'Cadastro de transportadoras do CONSART ERP (logística, documentos fiscais e SPED)';

COMMENT ON COLUMN public.transporters.tax_id IS 'CNPJ da transportadora (somente dígitos)';

COMMENT ON COLUMN public.transporters.cpf IS 'CPF quando a transportadora for pessoa física (somente dígitos)';

COMMENT ON COLUMN public.transporters.ibge_location_id IS 'Código IBGE do município';

COMMENT ON COLUMN public.transporters.rntrc IS 'Registro Nacional de Transportadores Rodoviários de Cargas (ANTT)';

-----------------------------------------------------------------------
-- Foreign keys that reference this table live in the other tables'
-- scripts:
--   budgetsShipping.transporter_id         → ON DELETE SET NULL
--   transportersAttachments.transporter_id → ON DELETE CASCADE
-----------------------------------------------------------------------

COMMIT;
