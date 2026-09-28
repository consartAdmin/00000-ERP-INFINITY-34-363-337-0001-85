-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ public."customersAttachments" — Anexos do cliente                  ║
-- ║ Arquivo no GCS: erp-infinity-00000/customers/{customer_id}/{uuid}  ║
-- ╚════════════════════════════════════════════════════════════════════╝

BEGIN;


CREATE TABLE IF NOT EXISTS public."customersAttachments" (
  attachment_id    BIGSERIAL PRIMARY KEY,
  customer_id      INTEGER      NOT NULL,
  original_name    VARCHAR(255) NOT NULL,
  storage_bucket   VARCHAR(100) NOT NULL,
  storage_path     VARCHAR(500) NOT NULL,
  mime_type        VARCHAR(150),
  size_bytes       BIGINT       NOT NULL DEFAULT 0,
  category         VARCHAR(30)  NOT NULL DEFAULT 'documento',
  description      TEXT,
  uploaded_by      INTEGER,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMP,
  deleted_by       INTEGER,

  CONSTRAINT "customersAttachments_customer_id_fkey"
    FOREIGN KEY (customer_id)
    REFERENCES public.customers (customer_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT "customersAttachments_category_check"
    CHECK (category IN ('documento', 'contrato', 'comprovante', 'outros')),

  CONSTRAINT "customersAttachments_size_check"
    CHECK (size_bytes >= 0)
);

-- Um objeto do bucket pertence a um único anexo
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_attachments_storage_path
  ON public."customersAttachments" (storage_path);

-- Listagem da aba "Anexos" (só ativos, mais recentes primeiro)
CREATE INDEX IF NOT EXISTS idx_customers_attachments_customer_active
  ON public."customersAttachments" (customer_id, created_at DESC)
  WHERE is_active = TRUE;

COMMIT;