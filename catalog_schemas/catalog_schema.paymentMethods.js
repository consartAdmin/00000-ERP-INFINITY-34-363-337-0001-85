// ╔══════════════════════════════════════════════════════╗
// ║ catalog_schema.paymentMethods.js                     ║
// ║ CONSART ERP — Schema da tabela paymentMethods (ESM)  ║
// ╚══════════════════════════════════════════════════════╝

export const PAYMENT_METHODS = Object.freeze({
  table: 'public."paymentMethods"',
  pk: '"paymentMethods_id"',

  columns: {
    paymentMethods_id: { db: '"paymentMethods_id"', type: 'integer', pk: true, generated: true },

    name:        { db: '"name"',         type: 'text',    required: true, uniqueLower: true, max: 80 },
    type:        { db: '"type"',         type: 'text',    required: true, enum: ['AVISTA','PARCELADO','MISTO'], default: 'AVISTA' },
    installments:{ db: '"installments"', type: 'integer', required: true, min: 1, default: 1 },

    gap_one:     { db: '"gap_one"',      type: 'integer', min: 0, default: 0 },
    gap_two:     { db: '"gap_two"',      type: 'integer', min: 0, default: 0 },
    gap_three:   { db: '"gap_three"',    type: 'integer', min: 0, default: 0 },
    gap_four:    { db: '"gap_four"',     type: 'integer', min: 0, default: 0 },

    active:      { db: '"active"',       type: 'boolean', default: true },

    created_at:  { db: '"created_at"',   type: 'timestamp', readOnly: true },
    updated_at:  { db: '"updated_at"',   type: 'timestamp', readOnly: true },
  },

  // Aliases (pt/en) para payloads do frontend/backend
  aliases: {
    id: 'paymentMethods_id',
    nome: 'name',
    tipo: 'type',
    parcelas: 'installments',
    intervalo1: 'gap_one',
    intervalo2: 'gap_two',
    intervalo3: 'gap_three',
    intervalo4: 'gap_four',
    ativo: 'active',
    criado_em: 'created_at',
    atualizado_em: 'updated_at',
  },

  // Mapeamento básico para INSERT/UPDATE seguro
  toDb(payload = {}) {
    const pick = (k, d) => (payload[k] !== undefined ? payload[k] : d);

    return {
      '"name"':          pick('name', null),
      '"type"':          pick('type', 'AVISTA'),
      '"installments"':  Number(pick('installments', 1)) || 1,

      '"gap_one"':       Number(pick('gap_one', 0))   || 0,
      '"gap_two"':       Number(pick('gap_two', 0))   || 0,
      '"gap_three"':     Number(pick('gap_three', 0)) || 0,
      '"gap_four"':      Number(pick('gap_four', 0))  || 0,

      '"active"':        !!pick('active', true),
    };
  },

  // Sanitização para resposta (DB -> API)
  fromDb(row = {}) {
    return {
      paymentMethods_id: row.paymentMethods_id,
      name: row.name,
      type: row.type,
      installments: Number(row.installments ?? 1),
      gap_one: Number(row.gap_one ?? 0),
      gap_two: Number(row.gap_two ?? 0),
      gap_three: Number(row.gap_three ?? 0),
      gap_four: Number(row.gap_four ?? 0),
      active: !!row.active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },
});

export default PAYMENT_METHODS;
