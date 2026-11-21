// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.supplier.js — Fornecedor do cadastro (CONSART ERP)    ║
// ║ Lupa / duplo clique abre o suppliersModalSearch e preenche Razão     ║
// ║ social e CNPJ/CPF da entrada. Digitar à mão continua permitido.      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { openSuppliersModalSearch } from '/public/modalsSearch/suppliersModalSearch.js';
import { $, toast } from './expenseEntries.utils.js';

const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

async function pickSupplier() {
  try {
    const supplier = await openSuppliersModalSearch();
    if (!supplier) return;
    $('#supplierName').value = supplier.name ?? supplier.supplier_name ?? '';
    $('#supplierDocument').value = onlyDigits(supplier.tax_id);
  } catch (error) {
    toast(`Não foi possível abrir a busca de fornecedores: ${error.message}`, 'error');
  }
}

function clearSupplier() {
  $('#supplierName').value = '';
  $('#supplierDocument').value = '';
  $('#supplierName').focus();
}

export function setupSupplierSearch() {
  $('#btnSearchSupplier')?.addEventListener('click', pickSupplier);
  $('#supplierName')?.addEventListener('dblclick', pickSupplier);
  $('#btnClearSupplier')?.addEventListener('click', clearSupplier);
}
