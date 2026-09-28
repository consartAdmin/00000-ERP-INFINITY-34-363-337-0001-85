-----------------------------------------------------------------------
-- Create the nfeReceipts table (Canhoto Digital da NF-e)
-- Mirrors the real schema (\d "nfeReceipts")
-- Depends on: public."invoicesIssued" (FK nfe_id → invoice_id)
-----------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS public."nfeReceipts" (
    --------------------------------------------------------------------
    -- Identification
    --------------------------------------------------------------------
    receipt_id        BIGSERIAL,

    nfe_id            BIGINT                   NOT NULL,
    access_key        VARCHAR(44)              NOT NULL,

    status            VARCHAR(20)              NOT NULL DEFAULT 'PENDING',

    --------------------------------------------------------------------
    -- Receiver
    --------------------------------------------------------------------
    receiver_name     VARCHAR(180),
    receiver_document VARCHAR(20),
    receiver_phone    VARCHAR(30),

    --------------------------------------------------------------------
    -- Delivery result
    --------------------------------------------------------------------
    received_at       TIMESTAMPTZ,
    refused_at        TIMESTAMPTZ,
    refusal_reason    TEXT,

    --------------------------------------------------------------------
    -- Signature (external file reference)
    --------------------------------------------------------------------
    signature_path    TEXT,
    signature_url     TEXT,

    --------------------------------------------------------------------
    -- Geolocation and device
    --------------------------------------------------------------------
    latitude          NUMERIC(10, 7),
    longitude         NUMERIC(10, 7),

    ip_address        INET,
    user_agent        TEXT,

    --------------------------------------------------------------------
    -- Additional information
    --------------------------------------------------------------------
    notes             TEXT,

    --------------------------------------------------------------------
    -- Audit
    --------------------------------------------------------------------
    created_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

    --------------------------------------------------------------------
    -- Signature image (added later — kept last, as in the real table)
    --------------------------------------------------------------------
    signature_png     BYTEA,

    --------------------------------------------------------------------
    -- Primary key
    --------------------------------------------------------------------
    CONSTRAINT "nfeReceipts_pkey" PRIMARY KEY (receipt_id),

    --------------------------------------------------------------------
    -- Foreign keys
    --------------------------------------------------------------------
    CONSTRAINT "nfeReceipts_nfe_id_fkey"
        FOREIGN KEY (nfe_id)
        REFERENCES public."invoicesIssued" (invoice_id)
        ON DELETE CASCADE,

    --------------------------------------------------------------------
    -- One receipt per NF-e
    --------------------------------------------------------------------
    CONSTRAINT nfe_receipts_nfe_unique
        UNIQUE (nfe_id),

    --------------------------------------------------------------------
    -- Validation
    --------------------------------------------------------------------
    CONSTRAINT nfe_receipts_access_key_chk
        CHECK (access_key ~ '^[0-9]{44}$'),

    CONSTRAINT nfe_receipts_status_chk
        CHECK (status IN ('PENDING', 'SIGNED', 'REFUSED', 'CANCELLED'))
);

-----------------------------------------------------------------------
-- Unique access key
-----------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS ux_nfe_receipts_access_key ON public."nfeReceipts" (access_key);

-----------------------------------------------------------------------
-- Search indexes
-----------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_nfe_receipts_access_key ON public."nfeReceipts" (access_key);

CREATE INDEX IF NOT EXISTS idx_nfe_receipts_nfe_id ON public."nfeReceipts" (nfe_id);

CREATE INDEX IF NOT EXISTS idx_nfe_receipts_received_at ON public."nfeReceipts" (received_at);

CREATE INDEX IF NOT EXISTS idx_nfe_receipts_status ON public."nfeReceipts" (status);

-----------------------------------------------------------------------
-- Table and column documentation
-----------------------------------------------------------------------

COMMENT ON
TABLE public."nfeReceipts" IS 'Canhoto digital da NF-e: confirmação eletrônica de recebimento da mercadoria';

COMMENT ON COLUMN public."nfeReceipts".nfe_id IS 'NF-e emitida (invoicesIssued.invoice_id)';

COMMENT ON COLUMN public."nfeReceipts".access_key IS 'Chave de acesso da NF-e (44 dígitos)';

COMMENT ON COLUMN public."nfeReceipts".status IS 'PENDING, SIGNED, REFUSED ou CANCELLED';

COMMENT ON COLUMN public."nfeReceipts".receiver_document IS 'CPF/documento do recebedor (somente dígitos)';

COMMENT ON COLUMN public."nfeReceipts".signature_png IS 'Imagem PNG da assinatura do recebedor';

COMMENT ON COLUMN public."nfeReceipts".latitude IS 'Latitude do dispositivo no momento da assinatura';

COMMENT ON COLUMN public."nfeReceipts".longitude IS 'Longitude do dispositivo no momento da assinatura';

COMMIT;
