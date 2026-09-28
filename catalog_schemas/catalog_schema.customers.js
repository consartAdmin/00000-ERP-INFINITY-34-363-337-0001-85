// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🧩 catalog_schema.customers.js — Schema Catalog: Customers (CONSART ERP) ║
// ║ Estrutura e metadados da tabela `customers`.                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const CUSTOMERS_SCHEMA = Object.freeze({
  table: 'customers',
  alias: 'c',

  columns: {
    // 🧱 Identificação
    customer_id:            { type: 'SERIAL', pk: true, comment: 'Unique customer identifier' },

    // 📋 Dados gerais
    trade_name:             { type: 'VARCHAR(255)', comment: 'Trade name (Nome fantasia)' },
    tax_id:                 { type: 'VARCHAR(32)', comment: 'CNPJ or CPF' },
    legal_name:             { type: 'VARCHAR(255)', comment: 'Legal company name (Razão Social)' },
    business_segment:       { type: 'VARCHAR(100)', comment: 'Business segment or industry' },
    classification:         { type: 'VARCHAR(100)', comment: 'Customer classification or category' },
    salesperson:            { type: 'VARCHAR(100)', comment: 'Responsible salesperson' },
    is_active:              { type: 'BOOLEAN', default: true, comment: 'Whether the customer is active' },

    // 📧 Contatos
    email:                  { type: 'VARCHAR(255)', comment: 'Customer e-mail' },
    contact_name:           { type: 'VARCHAR(150)', comment: 'Main contact person' },
    phone_number:           { type: 'VARCHAR(50)', comment: 'Phone number' },
    mobile_number:          { type: 'VARCHAR(50)', comment: 'Mobile number' },

    // 🏠 Endereço
    postal_code:            { type: 'VARCHAR(15)', comment: 'Postal code (CEP)' },
    street_type:            { type: 'VARCHAR(50)', comment: 'Type of street (Rua, Av, etc)' },
    street_name:            { type: 'VARCHAR(255)', comment: 'Street name' },
    street_number:          { type: 'VARCHAR(20)', comment: 'Street number' },
    address_complement:     { type: 'VARCHAR(255)', comment: 'Address complement' },
    neighborhood:           { type: 'VARCHAR(100)', comment: 'Neighborhood (Bairro)' },
    city:                   { type: 'VARCHAR(100)', comment: 'City' },
    state:                  { type: 'VARCHAR(50)', comment: 'State (UF)' },

    // 📦 Integrações
    asaas_id:               { type: 'VARCHAR(100)', comment: 'External Asaas API ID' },

    // 🧾 Registros fiscais
    state_registration:     { type: 'VARCHAR(100)', comment: 'State registration (Inscrição Estadual)' },
    municipal_registration: { type: 'VARCHAR(100)', comment: 'Municipal registration (Inscrição Municipal)' },

    // 🕓 Auditoria
    created_at:             { type: 'TIMESTAMP', default: 'NOW()', comment: 'Creation timestamp' },
    updated_at:             { type: 'TIMESTAMP', default: 'NOW()', comment: 'Last update timestamp' }
  }
});

export default CUSTOMERS_SCHEMA;
