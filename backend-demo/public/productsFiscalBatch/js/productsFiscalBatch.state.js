// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsFiscalBatch.state.js                                 ║
// ║ MODULE: Products Fiscal Batch — State                              ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { DEFAULT_PAGE_SIZE } from './productsFiscalBatch.config.js';

export const state = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  linkedTotal: 0,
  unlinkedTotal: 0,
  search: '',
  linkedFilter: '',
  sortColumn: 'product_code',
  sortDirection: 'asc',
  loading: false,
  products: [],
  // product_code → { id, code, description }
  selected: new Map(),
  // classificação escolhida no modal de vínculo
  classification: null,
};

const $ = (selector, root = document) => root.querySelector(selector);

export const dom = {
  table: $('#pfb-table'),
  searchInput: $('#pfb-search-input'),
  searchButton: $('#pfb-search-btn'),
  clearButton: $('#pfb-clear-btn'),
  reloadButton: $('#pfb-reload-btn'),
  linkedFilter: $('#pfb-linked-filter'),
  productsBody: $('#pfb-products-body'),
  selectAll: $('#pfb-select-all'),
  openLinkButton: $('#pfb-open-link'),
  unlinkSelectedButton: $('#pfb-unlink-selected'),
  selectedCount: $('#pfb-selected-count'),
  previousButton: $('#btnPrevious'),
  nextButton: $('#btnNext'),
  pageInfo: $('#pageInfo'),
  pageSize: $('#pageSize'),
  tableInfo: $('#apTableInfo'),
  sumLinked: $('#pfb-sum-linked'),
  sumUnlinked: $('#pfb-sum-unlinked'),
  sumSelected: $('#pfb-sum-selected'),

  // modal de vínculo
  linkCount: $('#pfb-link-count'),
  linkProducts: $('#pfb-link-products'),
  pickClassificationButton: $('#pfb-pick-classification'),
  classificationName: $('#pfb-classification-name'),
  classificationNcm: $('#pfb-classification-ncm'),
  classificationCest: $('#pfb-classification-cest'),
  classificationProfile: $('#pfb-classification-profile'),
  applyButton: $('#pfb-apply-batch'),
};
