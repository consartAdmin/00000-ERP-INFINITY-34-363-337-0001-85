import { bindProductsLmRefActions, refreshProductsLmRef } from './productsLmRef.actions.js';
import { resetProductsLmRefForm } from './productsLmRef.form.js';

function initProductsLmRef() {
  resetProductsLmRefForm();
  bindProductsLmRefActions();
  refreshProductsLmRef();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProductsLmRef);
} else {
  initProductsLmRef();
}

