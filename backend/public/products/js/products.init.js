// ╔══════════════════════════════════════════════════════════════════════╗
// ║ products.init.js — Inicialização do módulo de produtos              ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './products.state.js';
import { fmtInt } from './products.utils.js';
import { getLimitSelect, setStatus } from './products.dom.js';

import {
  bindSearch,
  bindLimit,
  bindFilters,
  loadFilterOptions
} from './products.search.js';

import { bindExport, bindStockPdf } from './products.export.js';
import { bindCameraDropZone } from './products.dragdrop.js';
import { loadProducts, renderTableHeader } from './products.render.js';
import { resolveShowProductImages } from '/public/includes/js/productImagesFeature.js';

async function bootstrap() {
  try {
    const sel = getLimitSelect();
    if (sel) state.limit = fmtInt(sel.value, 20);

    bindSearch();
    bindLimit();
    bindFilters();

    // appFeature PRODUCT_SEARCH_IMAGE_MODE: sem a feature cadastrada → exibe
    const [showImages] = await Promise.all([
      resolveShowProductImages(),
      loadFilterOptions(),
    ]);
    state.showImages = showImages;
    // cabeçalho já no modo certo antes de a lista carregar
    renderTableHeader();

    bindExport();
    bindCameraDropZone();
    bindStockPdf();

    loadProducts();
  } catch (e) {
    console.error('[products] bootstrap error:', e);
    setStatus('Falha ao inicializar a página de produtos.', 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}