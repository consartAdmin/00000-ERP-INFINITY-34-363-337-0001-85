// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.paymentForm.js — Meios de Pagamento (NF-e tPag) — CONSART  ║
// ║ Tabela física: public."paymentForms"                                      ║
// ║ Usado para DINHEIRO, PIX, BOLETO, CARTÃO CRÉDITO / DÉBITO…                ║
// ╚════════════════════════════════════════════════════════════════════════════╝

export const PAYMENT_FORMS_SCHEMA = Object.freeze({
  table: 'paymentForms',
  alias: 'pfm',

  /* ----------------------------------------------------------------------- */
  /* 🧱 Colunas                                                              */
  /* ----------------------------------------------------------------------- */
  columns: {
    // 🔑 Identificador principal
    paymentForms_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do meio de pagamento',
    },

    // 🏷️ Nome descritivo (DINHEIRO, PIX, BOLETO BANCÁRIO…)
    name: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Nome do meio de pagamento (ex.: DINHEIRO, PIX, BOLETO)',
    },

    // 🔢 Código tPag NF-e (01=dinheiro, 03=cartão crédito, 17=pix…)
    nfe_tpag: {
      type: 'CHAR(2)',
      notNull: true,
      comment: 'Código tPag da NF-e referente ao meio de pagamento',
    },

    // ✅ Ativo / inativo (soft delete)
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: 'TRUE',
      comment: 'Indica se o meio de pagamento está ativo para uso',
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMP WITHOUT TIME ZONE',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação do registro',
    },
    updated_at: {
      type: 'TIMESTAMP WITHOUT TIME ZONE',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora da última atualização',
    },
  },

  /* ----------------------------------------------------------------------- */
  /* 📚 Índices e constraints adicionais                                     */
  /* ----------------------------------------------------------------------- */
  indexes: {
    // Nome único (case-insensitive)
    idx_paymentforms_name_unique: {
      unique: true,
      columns: ['LOWER(name)'],
      using: 'btree',
      comment: 'Garante nome único de meio de pagamento (case-insensitive)',
    },

    // Código tPag único
    idx_paymentforms_tpag_unique: {
      unique: true,
      columns: ['nfe_tpag'],
      using: 'btree',
      comment: 'Garante código tPag único por meio de pagamento',
    },
  },

  /* ----------------------------------------------------------------------- */
  /* 🔁 Triggers (caso seu helper de DDL use essas infos)                    */
  /* ----------------------------------------------------------------------- */
  triggers: {
    tg_paymentforms_updated_at: {
      when: 'BEFORE',
      operation: 'UPDATE',
      function: 'trg_set_timestamp()', // ou o nome padrão que você usa
      level: 'ROW',
      comment: 'Atualiza updated_at automaticamente antes de cada UPDATE',
    },
  },
});

export default PAYMENT_FORMS_SCHEMA;
