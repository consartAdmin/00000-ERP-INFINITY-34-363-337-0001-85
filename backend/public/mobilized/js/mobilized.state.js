'use strict';

import { DEFAULT_LIMIT } from './mobilized.config.js';

export const state = {
  rows: [], total: 0, limit: DEFAULT_LIMIT, offset: 0,
  summary: { items_count: 0, items_total: 0, items_missing_price: 0 },
  sortColumn: 'acquired_at', sortDirection: 'desc',
  selectedId: null, selectedRow: null, items: [], attachments: [], selectedItemsTotal: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);

export const dom = {
  table: $('#mobilizedTable'), list: $('#tableBody'), form: $('#formMobilized'), itemsBody: $('#itemsBody'),
  q: $('#q'), statusFilter: $('#statusFilter'), periodFilter: $('#periodFilter'),
  btnNew: $('#btnNew'), btnRefresh: $('#btnRefresh'), btnSearch: $('#btnSearch'), btnClearFilters: $('#btnClearFilters'),
  // rodapé padrão
  tableInfo: $('#apTableInfo'), pageInfo: $('#infoPagina'), perPage: $('#perPage'),
  btnPrev: $('#pagAnterior'), btnNext: $('#pagProxima'),
  sumItems: $('#sumItems'), sumTotal: $('#sumTotal'), sumMissing: $('#sumMissing'),
  // modal detalhes
  detailsModal: $('#detailsModal'), detailsTitle: $('#detailsModalTitle'),
  btnSave: $('#btnSave'), btnDelete: $('#btnDelete'), btnAddItem: $('#btnAddItem'),
  btnPdfAll: $('#btnPdfAll'), btnPdfDownload: $('#btnPdfDownload'), btnOpenPdf: $('#btnOpenPdf'),
  btnPdfPickUpload: $('#btnPdfPickUpload'), btnPdfGenerateUpload: $('#btnPdfGenerateUpload'),
  pdfFile: $('#pdfFile'), pdfInfo: $('#pdfInfo'),
  kpiItemsCount: $('#kpiItemsCount'), kpiItemsTotal: $('#kpiItemsTotal'), kpiItemsMissing: $('#kpiItemsMissing'),
  itemsFootTotal: $('#itemsFootTotal'),
  // modal item
  itemModal: $('#itemModal'), itemModalTitle: $('#itemModalTitle'), btnItemSave: $('#btnItemSave'),
  btnItemSetImageUrl: $('#btnItemSetImageUrl'), btnItemClearImageUrl: $('#btnItemClearImageUrl'),
  itemImgPreview: $('#item_img_preview'),
};

export const fields = {
  mobilized_id: $('#mobilized_id'), title: $('#title'), status: $('#status'),
  acquired_at: $('#acquired_at'), source_system: $('#source_system'),
  external_ref: $('#external_ref'), notes: $('#notes'),
};

export const itemFields = {
  mobilized_item_id: $('#mobilized_item_id'), sku: $('#item_sku'), description: $('#item_description'),
  model: $('#item_model'), serial_number: $('#item_serial_number'), nfe_ref: $('#item_nfe_ref'),
  quantity: $('#item_quantity'), unit: $('#item_unit'), unit_price: $('#item_unit_price'),
  total_value: $('#item_total_value'), notes: $('#item_notes'),
};

export const itemImageFile = Object.assign(document.createElement('input'), {
  type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
});
