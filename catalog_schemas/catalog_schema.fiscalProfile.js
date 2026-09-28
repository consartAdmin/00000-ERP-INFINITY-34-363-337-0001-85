// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.fiscalProfile.js — Fiscal Profile Schema (CONSART ERP)     ║
// ║ Estrutura base da tabela fiscalProfile (perfis fiscais)                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const FISCAL_PROFILE_SCHEMA = Object.freeze({
  table: 'fiscalProfile',
  alias: 'fp',

  columns: {
    fiscal_profile_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Unique identifier for the fiscal profile'
    },
    profile_name: {
      type: 'VARCHAR(100)',
      notNull: true,
      comment: 'Internal profile name'
    },
    description: {
      type: 'TEXT',
      comment: 'Profile description'
    },
    icms_cst: {
      type: 'VARCHAR(10)',
      comment: 'ICMS CST code'
    },
    icms_rate: {
      type: 'NUMERIC(10,2)',
      comment: 'ICMS tax rate'
    },
    cfop_entry: {
      type: 'VARCHAR(10)',
      comment: 'CFOP for entries'
    },
    cfop_exit: {
      type: 'VARCHAR(10)',
      comment: 'CFOP for exits'
    },
    origin_code: {
      type: 'VARCHAR(5)',
      comment: 'Product origin code'
    },
    pis_cst: {
      type: 'VARCHAR(10)',
      comment: 'PIS CST code'
    },
    pis_rate: {
      type: 'NUMERIC(10,2)',
      comment: 'PIS rate'
    },
    cofins_cst: {
      type: 'VARCHAR(10)',
      comment: 'COFINS CST code'
    },
    cofins_rate: {
      type: 'NUMERIC(10,2)',
      comment: 'COFINS rate'
    },
    benefit_code: {
      type: 'VARCHAR(50)',
      comment: 'Optional fiscal benefit code'
    },
    is_active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Active status of the fiscal profile'
    },
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Creation date'
    },
    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Last update timestamp'
    }
  }
});
