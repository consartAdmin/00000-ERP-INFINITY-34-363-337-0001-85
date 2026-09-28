// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: locationsBarCode.state.js                                    ║
// ║ MODULE: Locations Barcode — State                                  ║
// ║ CONSART ERP · Frontend · ESM                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const state = {
  cacheBarcodes: [],
  filteredBarcodes: [],
  selectedIds: new Set(),
  currentRecord: null,
  currentPage: 1,
  pageSize: 50,
};

