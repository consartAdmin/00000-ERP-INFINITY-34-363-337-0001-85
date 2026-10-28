// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashFiscalDocuments.schema.js — Notas fiscais do Caixa             ║
// ║ Uma NF-e/NFS-e pode cobrir vários pagamentos (cashMoviments)       ║
// ║ Tabelas: "cashFiscalDocuments", "cashFiscalDocumentsAttachments"   ║
// ║ Coluna:  "cashMoviments".fiscal_document_id                        ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

let schemaReady = null;

export function ensureFiscalDocumentsSchema() {
  schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS "cashFiscalDocuments" (
      id BIGSERIAL PRIMARY KEY,
      document_type VARCHAR(40) NOT NULL DEFAULT 'NFS-e',
      document_number VARCHAR(60) NOT NULL,
      issue_date DATE NULL,
      issuer_name VARCHAR(255) NULL,
      issuer_tax_id VARCHAR(20) NULL,
      total_amount NUMERIC(14,2) NULL,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "cashFiscalDocumentsAttachments" (
      id BIGSERIAL PRIMARY KEY,
      fiscal_document_id BIGINT NOT NULL
        REFERENCES "cashFiscalDocuments"(id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NULL,
      file_size_bytes BIGINT NULL,
      storage_bucket VARCHAR(120) NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS "cashFiscalDocumentsAttachments_doc_idx"
      ON "cashFiscalDocumentsAttachments" (fiscal_document_id);

    ALTER TABLE "cashMoviments"
      ADD COLUMN IF NOT EXISTS fiscal_document_id BIGINT NULL
        REFERENCES "cashFiscalDocuments"(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS "cashMoviments_fiscal_document_idx"
      ON "cashMoviments" (fiscal_document_id);
  `).catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
