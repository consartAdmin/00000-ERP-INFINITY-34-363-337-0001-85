// ╔════════════════════════════════════════════════════════════════════╗
// ║ crmDealsSchema.repository.js — ensureCrmCompanyColumn              ║
// ║ Separa os cards por empresa: BH3 (CRM original) x CONSART (CRM     ║
// ║ Consart ERP). Cards antigos ficam com 'BH3' pelo DEFAULT.          ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { buildError } from './crmDeals.utils.js';

export async function ensureCrmCompanyColumn() {
  try {
    await pool.query(`
      ALTER TABLE public."crmDeals"
        ADD COLUMN IF NOT EXISTS crm_company VARCHAR(20) NOT NULL DEFAULT 'BH3';

      CREATE INDEX IF NOT EXISTS idx_crmDeals_crm_company
        ON public."crmDeals"(crm_company);
    `);
    return { ok: true };
  } catch (err) {
    return buildError(err, 'crmDealsApi.ensureCrmCompanyColumn');
  }
}

// backend-consart: os cards do CRM Consart ERP apontam para os cadastros da Consart.
// O banco veio com "crmDeals".customer_id → customers (BH3), o que recusa todo card de
// cliente da Consart (FK crmDealsReativation_customer_id_fkey). Cada FK de crmDeals
// para customers / sellers / customerStatusTypes passa a apontar para a tabela
// *Consart. NOT VALID: cards antigos não são conferidos, só os novos.
let consartFksPromise = null;

export function ensureCrmDealsConsartFks() {
  if (!consartFksPromise) {
    consartFksPromise = runEnsureCrmDealsConsartFks().then((r) => {
      if (!r.ok) consartFksPromise = null; // tenta de novo no próximo card
      return r;
    });
  }
  return consartFksPromise;
}

async function runEnsureCrmDealsConsartFks() {
  try {
    await pool.query(`
      DO $$
      DECLARE
        fk RECORD;
        target TEXT;
      BEGIN
        FOR fk IN
          SELECT c.conname,
                 a.attname  AS col,
                 rt.relname AS ref_table,
                 ra.attname AS ref_col
          FROM pg_constraint c
          JOIN pg_class t  ON t.oid = c.conrelid
          JOIN pg_class rt ON rt.oid = c.confrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
          JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
          WHERE c.contype = 'f'
            AND n.nspname = 'public'
            AND t.relname = 'crmDeals'
            AND array_length(c.conkey, 1) = 1
            AND rt.relname IN ('customers', 'sellers', 'customerStatusTypes')
        LOOP
          target := fk.ref_table || 'Consart';
          IF to_regclass(format('public.%I', target)) IS NULL THEN
            RAISE NOTICE 'Pulando %: tabela % não existe', fk.conname, target;
            CONTINUE;
          END IF;

          EXECUTE format('ALTER TABLE public."crmDeals" DROP CONSTRAINT %I', fk.conname);
          EXECUTE format(
            'ALTER TABLE public."crmDeals" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) NOT VALID',
            'fk_crmDeals_' || fk.col || '_consart', fk.col, target, fk.ref_col
          );
          RAISE NOTICE 'crmDeals.%: % → %', fk.col, fk.conname, target;
        END LOOP;
      END$$;
    `);

    // Sobrou FK para tabela da BH3 (tabela *Consart ainda não criada no boot): tenta de novo depois
    const { rows } = await pool.query(`
      SELECT count(*)::int AS n
      FROM pg_constraint c
      JOIN pg_class t  ON t.oid = c.conrelid
      JOIN pg_class rt ON rt.oid = c.confrelid
      WHERE c.contype = 'f'
        AND t.relname = 'crmDeals'
        AND rt.relname IN ('customers', 'sellers', 'customerStatusTypes')
    `);
    if (rows[0]?.n > 0) return { ok: false, error: 'CONSART_TABLES_NOT_READY' };

    return { ok: true };
  } catch (err) {
    return buildError(err, 'crmDealsApi.ensureCrmDealsConsartFks');
  }
}
