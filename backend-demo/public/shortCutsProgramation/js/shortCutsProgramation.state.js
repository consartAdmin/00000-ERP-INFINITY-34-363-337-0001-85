// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: shortCutsProgramation.state.js                                ║
// ║ MODULE: Programming Shortcuts — State                               ║
// ║ DESCRIPTION: Estado compartilhado e referências dos elementos DOM   ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const state = {
    page: 1,
    limit: 50,
    total: 0,
    rows: [],
    categories: [],
    subcategories: [],
    selectedId: null,
};

export const els = {};
