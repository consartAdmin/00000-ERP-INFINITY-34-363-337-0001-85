// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/routes/caixaRoutes.js                                       ║
// ║ — Rotas Express do módulo Caixa                                     ║
// ║ CONSART ERP — ESM                                                   ║
// ║ ✅ Compatível com controller usando cashMovimentsApi.js             ║
// ║ ✅ Mantém endpoints antigos do frontend                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';

import {
  listMovimentacoes,
  getMovimentacao,
  createMovimentacao,
  updateMovimentacao,
  deleteMovimentacao,

  deleteMovimentacoesLote,
  updateMovimentacoesLote,

  listChartAccountsForCaixa,

  listCategorias,
  createCategoria,
  updateCategoriaCtrl,
  deleteCategoriaCtrl,

  // Subcategorias
  listSubcategorias,
  createSubcategoriaCtrl,
  updateSubcategoriaCtrl,
  deleteSubcategoriaCtrl,

  // Resumos / PDFs
  summary,
  saldos,
  relatorioPdf,

  // Status ativo/inativo + sub por categoria
  setCategoriaAtivaCtrl,
  setSubcategoriaAtivaCtrl,
  listSubcategoriasByCategoria,
} from '../controllers/cashMovimentsController.js';

import {
  listAnexosCaixa,
  countAnexosCaixa,
  deleteAnexoCaixa,
} from '../uploadBuckets/uploadBucketsCashMoviments.js';

import {
  listNotas,
  getNota,
  listPagamentos,
  createNota,
  updateNota,
  vincularPagamentos,
  desvincularPagamentos,
  deleteNota,
  uploadAnexoNota,
  deleteAnexoNota,
} from '../controllers/cashFiscalDocumentsController.js';

import {
  createTransferencia,
  getTransferencia,
  updateTransferencia,
  deleteTransferencia,
} from '../controllers/cashTransfersController.js';

import {
  headZipPeriodo,
  downloadZipPeriodo,
} from '../controllers/cashMovimentsZipController.js';

const router = Router();

/* ================ TRANSFERÊNCIAS ENTRE CONTAS ======================= */

router.post('/transferencias', createTransferencia);
router.get('/transferencias/:id', getTransferencia);
router.put('/transferencias/:id', updateTransferencia);
router.delete('/transferencias/:id', deleteTransferencia);

/* ========================= MOVIMENTAÇÕES ============================ */

router.delete('/movimentacoes/lote', deleteMovimentacoesLote);
router.patch('/movimentacoes/lote', updateMovimentacoesLote);

router.get('/movimentacoes', listMovimentacoes);
router.get('/movimentacoes/:id', getMovimentacao);
router.post('/movimentacoes', createMovimentacao);
router.put('/movimentacoes/:id', updateMovimentacao);
router.delete('/movimentacoes/:id', deleteMovimentacao);

router.delete('/movimentos/lote', deleteMovimentacoesLote);

// Aliases para compatibilidade com o frontend antigo
router.get('/movimentos', listMovimentacoes);
router.get('/movimentos/:id', getMovimentacao);
router.post('/movimentos', createMovimentacao);
router.put('/movimentos/:id', updateMovimentacao);
router.delete('/movimentos/:id', deleteMovimentacao);

/* ========================= PLANO DE CONTAS =========================== */

router.get('/chart-accounts', listChartAccountsForCaixa);
router.get('/contas-contabeis', listChartAccountsForCaixa);

/* ========================= CATEGORIAS =============================== */

router.get('/categorias', listCategorias);
router.post('/categorias', createCategoria);
router.put('/categorias/:id', updateCategoriaCtrl);
router.delete('/categorias/:id', deleteCategoriaCtrl);

router.patch('/categorias/:id/active', setCategoriaAtivaCtrl);
router.get('/categorias/:categoriaId/subcategorias', listSubcategoriasByCategoria);

/* ========================= SUBCATEGORIAS ============================ */

router.get('/subcategorias', listSubcategorias);

// Legacy typo endpoint
router.post('/subcategororias', createSubcategoriaCtrl);

// Correct endpoint
router.post('/subcategorias', createSubcategoriaCtrl);

router.put('/subcategorias/:id', updateSubcategoriaCtrl);
router.delete('/subcategorias/:id', deleteSubcategoriaCtrl);

router.patch('/subcategorias/:id/active', setSubcategoriaAtivaCtrl);

/* ========================= ANEXOS =================================== */

// Upload fica em /api/upload/anexo

router.get('/movimentacoes/:id/anexos', listAnexosCaixa);
router.get('/movimentacoes/:id/anexos/count', countAnexosCaixa);
router.delete('/movimentacoes/:id/anexos/:anexoId', deleteAnexoCaixa);

// Compatibilidade antiga: /api/caixa/anexos?movimentacao_id=#
router.get('/anexos', (req, res) => {
  const id = Number(
    req.query.movimentacao_id ??
    req.query.cash_movement_id
  );

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      ok: false,
      error: 'movimentacao_id inválido',
    });
  }

  req.params.id = String(id);
  return listAnexosCaixa(req, res);
});

/* ========================= RESUMO / SALDOS / RELATÓRIO ============= */

router.get('/summary', summary);
router.get('/saldos', saldos);

router.head('/relatorio/pdf', (_req, res) => res.status(200).end());
router.get('/relatorio/pdf', relatorioPdf);

// Compatibilidade com frontend antigo
router.get('/relatorio', relatorioPdf);

/* ========================= NOTAS FISCAIS (NF-e/NFS-e) ================= */
// Uma nota pode cobrir vários pagamentos (ex.: 3 pagamentos, 1 NFS-e)

router.get('/notas-fiscais', listNotas);
router.get('/notas-fiscais/pagamentos', listPagamentos);
router.post('/notas-fiscais/desvincular', desvincularPagamentos);
router.get('/notas-fiscais/:id', getNota);
router.post('/notas-fiscais', createNota);
router.put('/notas-fiscais/:id', updateNota);
router.delete('/notas-fiscais/:id', deleteNota);
router.post('/notas-fiscais/:id/vincular', vincularPagamentos);
router.post('/notas-fiscais/:id/anexos', uploadAnexoNota);
router.delete('/notas-fiscais/:id/anexos/:anexoId', deleteAnexoNota);

/* ========================= ZIP DE ANEXOS ============================= */

router.head('/movimentacoes/zip/periodo', headZipPeriodo);
router.get('/movimentacoes/zip/periodo', downloadZipPeriodo);

export default router;