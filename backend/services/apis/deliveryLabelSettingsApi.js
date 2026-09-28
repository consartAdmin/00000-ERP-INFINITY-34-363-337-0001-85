// ╔══════════════════════════════════════════════════════════════╗
// ║ deliveryLabelSettingsApi.js — Parâmetros das Etiquetas      ║
// ║ Tabela: public."deliveryLabelSettings" (linha única id=1)   ║
// ║ CONSART ERP | ESM                                           ║
// ╚══════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."deliveryLabelSettings"';

// Valores padrão = layout original 60x30mm
export const DEFAULT_LABEL_SETTINGS = Object.freeze({
  width_mm: 60,
  height_mm: 30,
  margin_mm: 1.4,
  offset_x_mm: 0,
  offset_y_mm: 0,
  auto_scale: true,

  show_border: true,
  border_radius: 3,
  title_text: 'ETIQUETA DE ENTREGA',

  font_title: 7,
  font_customer: 7.8,
  font_body: 5.8,
  font_nfe: 11,
  font_volume: 18,

  print_summary: true,
  show_address: true,
  show_complement: true,
  show_neighborhood: true,
  show_city: true,
  show_nfe: true,
  show_volume: true,

  // Títulos dos campos ("Cliente:", "Logradouro:", ...)
  label_customer: true,
  label_address: true,
  label_complement: true,
  label_neighborhood: true,
  label_city: true,
  label_nfe: true,

  // Negrito: título ("Cliente:") e informação (valor) de cada campo
  bold_label_customer: true,
  bold_label_address: true,
  bold_label_complement: true,
  bold_label_neighborhood: true,
  bold_label_city: true,
  bold_label_nfe: true,
  bold_value_customer: false,
  bold_value_address: false,
  bold_value_complement: false,
  bold_value_neighborhood: false,
  bold_value_city: false,
  bold_value_nfe: true,

  // Alinhamento (left | center | right)
  align_title: 'center',
  align_customer: 'left',
  align_address: 'left',
  align_complement: 'left',
  align_neighborhood: 'left',
  align_city: 'left',
});

const ALIGN_VALUES = ['left', 'center', 'right'];

const FIELD_LABEL_KEYS = [
  'label_customer',
  'label_address',
  'label_complement',
  'label_neighborhood',
  'label_city',
  'label_nfe',
];

// [min, max] para campos numéricos
const NUMBER_LIMITS = {
  width_mm: [20, 300],
  height_mm: [15, 300],
  margin_mm: [0, 20],
  offset_x_mm: [-20, 20],
  offset_y_mm: [-20, 20],
  border_radius: [0, 20],
  font_title: [3, 40],
  font_customer: [3, 40],
  font_body: [3, 40],
  font_nfe: [3, 60],
  font_volume: [4, 80],
};

export function sanitizeLabelSettings(rawInput = {}) {
  const out = { ...DEFAULT_LABEL_SETTINGS };
  const input = { ...rawInput };

  // Compatibilidade: antigo parâmetro único show_field_labels vale para todos os títulos
  if (input.show_field_labels !== undefined) {
    for (const key of FIELD_LABEL_KEYS) input[key] ??= input.show_field_labels;
  }

  for (const [key, fallback] of Object.entries(DEFAULT_LABEL_SETTINGS)) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;

    if (typeof fallback === 'boolean') {
      out[key] = value === true || value === 'true' || value === 1 || value === '1';
    } else if (typeof fallback === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      const [min, max] = NUMBER_LIMITS[key];
      out[key] = Math.min(max, Math.max(min, n));
    } else if (key.startsWith('align_')) {
      if (ALIGN_VALUES.includes(value)) out[key] = value;
    } else {
      out[key] = String(value).trim().slice(0, 60);
    }
  }

  return out;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

let tableReady = null;

function ready() {
  if (!tableReady) {
    tableReady = ensureTable().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

export async function getLabelSettings() {
  await ready();
  const { rows } = await pool.query(`SELECT settings FROM ${TB} WHERE id = 1`);
  return sanitizeLabelSettings(rows[0]?.settings || {});
}

export async function saveLabelSettings(input = {}) {
  await ready();
  const settings = sanitizeLabelSettings(input);

  await pool.query(
    `
      INSERT INTO ${TB} (id, settings, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE
        SET settings = EXCLUDED.settings,
            updated_at = NOW()
    `,
    [JSON.stringify(settings)]
  );

  return settings;
}
