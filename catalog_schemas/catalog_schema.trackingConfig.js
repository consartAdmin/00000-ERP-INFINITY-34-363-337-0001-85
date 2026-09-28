// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.trackingConfig.js — Configurações de Tracking             ║
// ║ CONSART ERP                                                               ║
// ║ Armazena integrações: GTM, GA4, Ads, Meta Pixel                            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const TRACKINGCONFIG_SCHEMA = Object.freeze({
  table: 'trackingConfig',
  alias: 'tc',

  columns: {
    // 🧱 Identificação
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da configuração de tracking'
    },

    // 🔷 Google Tag Manager
    gtm_container_id: {
      type: 'VARCHAR(64)',
      comment: 'ID do container GTM (ex: GTM-XXXX)'
    },

    gtm_enabled: {
      type: 'BOOLEAN',
      default: false,
      comment: 'Indica se o GTM está ativo'
    },

    // 🔷 Google Analytics 4
    ga4_measurement_id: {
      type: 'VARCHAR(64)',
      comment: 'Measurement ID do GA4 (ex: G-XXXX)'
    },

    ga4_api_secret: {
      type: 'VARCHAR(255)',
      comment: 'API Secret para GA4 Measurement Protocol'
    },

    ga4_enabled: {
      type: 'BOOLEAN',
      default: false,
      comment: 'Indica se o GA4 está ativo'
    },

    // 🔷 Google Ads
    ads_conversion_id: {
      type: 'VARCHAR(64)',
      comment: 'ID da conversão no Google Ads'
    },

    ads_conversion_label: {
      type: 'VARCHAR(128)',
      comment: 'Label da conversão no Google Ads'
    },

    ads_enabled: {
      type: 'BOOLEAN',
      default: false,
      comment: 'Indica se o Google Ads está ativo'
    },

    // 🔷 Meta Pixel
    meta_pixel_id: {
      type: 'VARCHAR(64)',
      comment: 'ID do Pixel do Meta (Facebook)'
    },

    meta_enabled: {
      type: 'BOOLEAN',
      default: false,
      comment: 'Indica se o Meta Pixel está ativo'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data de criação do registro'
    },

    updated_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data da última atualização'
    }
  }
});
