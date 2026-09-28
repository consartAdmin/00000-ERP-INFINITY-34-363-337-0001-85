// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.localizationProducts.js — Location Schemas (CONSART ERP) ║
// ║ - locationLocals       → Stores / warehouses                             ║
// ║ - locationCorridors    → Corridors inside a local                        ║
// ║ - locationShelves      → Shelves inside a corridor                       ║
// ║ - locationBins         → Bins inside a shelf                             ║
// ║ - locationPositions    → Positions / slots inside a bin                  ║
// ║ - localizationProducts → Link product_code → full location hierarchy     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/* ------------------------------------------------------------------------- */
/* 1) locationLocals — stores / warehouses                                   */
/* ------------------------------------------------------------------------- */

export const LOCATION_LOCALS_SCHEMA = Object.freeze({
  table: 'locationLocals',
  alias: 'll',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do local (loja / depósito)',
    },
    name: {
      type: 'VARCHAR(50)',
      notNull: true,
      unique: true,
      comment: 'Nome curto do local (ex: LOJA 1, DEPÓSITO CENTRAL)',
    },
    description: {
      type: 'TEXT',
      comment: 'Descrição opcional / observações sobre o local',
    },
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Indica se o local está ativo para uso',
    },
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    idx_locationlocals_name: {
      columns: ['name'],
      unique: true,
      comment: 'Garante nomes únicos de locais',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* 2) locationCorridors — corridors by local                                 */
/* ------------------------------------------------------------------------- */

export const LOCATION_CORRIDORS_SCHEMA = Object.freeze({
  table: 'locationCorridors',
  alias: 'lc',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do corredor',
    },
    name: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Identificação do corredor (ex: A1, B3)',
    },
    description: {
      type: 'TEXT',
      comment: 'Descrição opcional do corredor',
    },
    local_id: {
      type: 'INTEGER',
      comment: 'FK opcional para locationLocals.id',
      references: {
        table: 'locationLocals',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    },
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Indica se o corredor está ativo',
    },
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    idx_locationcorridors_name: {
      columns: ['name'],
      unique: false,
      comment: 'Index para busca rápida por nome de corredor',
    },
    idx_locationcorridors_local: {
      columns: ['local_id', 'name'],
      unique: true,
      comment: 'Um mesmo nome de corredor não se repete dentro do mesmo local',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* 3) locationShelves — shelves by corridor                                  */
/* ------------------------------------------------------------------------- */

export const LOCATION_SHELVES_SCHEMA = Object.freeze({
  table: 'locationShelves',
  alias: 'ls',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da prateleira',
    },
    name: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Identificação da prateleira (ex: 3, 4B)',
    },
    description: {
      type: 'TEXT',
      comment: 'Descrição opcional da prateleira',
    },
    corridor_id: {
      type: 'INTEGER',
      comment: 'FK opcional para locationCorridors.id',
      references: {
        table: 'locationCorridors',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    },
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Indica se a prateleira está ativa',
    },
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    idx_locationshelves_corridor_name: {
      columns: ['corridor_id', 'name'],
      unique: true,
      comment:
        'Evita duplicidade de prateleira com o mesmo nome dentro de um corredor',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* 4) locationBins — bins by shelf                                          */
/* ------------------------------------------------------------------------- */

export const LOCATION_BINS_SCHEMA = Object.freeze({
  table: 'locationBins',
  alias: 'lb',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do bin / caixa / gaveta',
    },
    name: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Identificação do bin (ex: B, C, 7B)',
    },
    description: {
      type: 'TEXT',
      comment: 'Descrição opcional do bin',
    },
    shelf_id: {
      type: 'INTEGER',
      comment: 'FK opcional para locationShelves.id',
      references: {
        table: 'locationShelves',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    },
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Indica se o bin está ativo',
    },
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    idx_locationbins_shelf_name: {
      columns: ['shelf_id', 'name'],
      unique: true,
      comment:
        'Evita duplicidade de bins com o mesmo nome dentro de uma prateleira',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* 5) locationPositions — positions by bin                                  */
/* ------------------------------------------------------------------------- */

export const LOCATION_POSITIONS_SCHEMA = Object.freeze({
  table: 'locationPositions',
  alias: 'lp',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da posição',
    },
    name: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Identificação da posição (ex: 7, 7A)',
    },
    description: {
      type: 'TEXT',
      comment: 'Descrição opcional da posição',
    },
    bin_id: {
      type: 'INTEGER',
      comment: 'FK opcional para locationBins.id',
      references: {
        table: 'locationBins',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    },
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Indica se a posição está ativa',
    },
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    idx_locationpositions_bin_name: {
      columns: ['bin_id', 'name'],
      unique: true,
      comment:
        'Evita duplicidade de posições com o mesmo nome dentro de um bin',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* 6) localizationProducts — link product_code → location hierarchy         */
/* ------------------------------------------------------------------------- */

export const LOCALIZATION_PRODUCTS_SCHEMA = Object.freeze({
  table: 'localizationProducts',
  alias: 'pl',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da localização do produto',
    },

    // 🔗 Product reference (já com FK física no banco)
    product_code: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Código do produto (FK para products.product_code)',
      references: {
        table: 'products',
        column: 'product_code',
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
    },

    // 📍 Hierarquia normalizada (opcional: pode usar só texto se quiser)
    local_id: {
      type: 'INTEGER',
      comment: 'FK para locationLocals.id',
      references: {
        table: 'locationLocals',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    },
    corridor_id: {
      type: 'INTEGER',
      comment: 'FK para locationCorridors.id',
      references: {
        table: 'locationCorridors',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    },
    shelf_id: {
      type: 'INTEGER',
      comment: 'FK para locationShelves.id',
      references: {
        table: 'locationShelves',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    },
    bin_id: {
      type: 'INTEGER',
      comment: 'FK para locationBins.id',
      references: {
        table: 'locationBins',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    },
    position_id: {
      type: 'INTEGER',
      comment: 'FK para locationPositions.id',
      references: {
        table: 'locationPositions',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    },

    // 🔁 Campos de texto legados (se você quiser manter também)
    local: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment:
        'Local (texto) — pode ser mantido por compatibilidade ou migrado no futuro',
    },
    corridor: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Corredor (texto)',
    },
    shelf: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Prateleira (texto)',
    },
    bin: {
      type: 'VARCHAR(50)',
      comment: 'Bin / caixa (texto)',
    },
    position: {
      type: 'VARCHAR(50)',
      comment: 'Posição (texto)',
    },

    notes: {
      type: 'TEXT',
      comment: 'Observações sobre a localização do produto',
    },

    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    idx_localization_product_code: {
      columns: ['product_code'],
      unique: false,
      comment: 'Busca rápida por produto',
    },
    idx_localization_product_unique_slot: {
      columns: ['product_code', 'local_id', 'corridor_id', 'shelf_id', 'bin_id', 'position_id'],
      unique: true,
      comment: 'Evita cadastrar o MESMO produto duas vezes na MESMA posição',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* Export bundle                                                            */
/* ------------------------------------------------------------------------- */

const LOCATION_SCHEMAS = Object.freeze({
  LOCATION_LOCALS_SCHEMA,
  LOCATION_CORRIDORS_SCHEMA,
  LOCATION_SHELVES_SCHEMA,
  LOCATION_BINS_SCHEMA,
  LOCATION_POSITIONS_SCHEMA,
  LOCALIZATION_PRODUCTS_SCHEMA,
});

export default LOCATION_SCHEMAS;
