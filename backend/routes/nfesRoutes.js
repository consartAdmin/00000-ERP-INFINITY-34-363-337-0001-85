// ╔══════════════════════════════════════════════════════════════╗
// ║ nfesRoutes.js — Rotas NF-e (CONSART ERP | PlugNotas/Tecno)   ║
// ║ Busca, reconcile, refresh, XML/PDF, e-mail, debug e relatório║
// ╚══════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import {
  searchNfes,
  getNfeByOrderId,
  reconcileNfe,
  refreshSingle,
  downloadDanfeCtrl,
  downloadXmlCtrl,
  downloadXmlLoteCtrl,
  getResumoCtrl,
  diagAmbiente,
  ambienteDiagnosticoCtrl,
  debugEnv,
  listRegisteredRoutes,
  debugBaixaEstoque,
  sendNfeEmailCtrl,
  exportarRelatorioPdf,
  exportarRelatorioExcel,
} from '../controllers/nfesController.js';

const r = Router();

/**
 * IMPORTANTE:
 * Este router está montado no server como:
 *   app.use('/api/nfes', nfesRoutes);
 *
 * Portanto, TODAS as rotas abaixo são relativas a /api/nfes.
 *
 * REGRA:
 * Rotas mais específicas devem vir antes das rotas dinâmicas (/:id, /:orderId),
 * para evitar conflito de matching no Express.
 */

// ──────────────────────────────────────────────────────────────
// Relatórios / exportações
// ──────────────────────────────────────────────────────────────

// Relatório PDF de NF-es para conferência contábil
// GET /api/nfes/report/pdf?q=...&nfeStatus=...&dataIni=...&dataFim=...&sortBy=...&sortOrder=...
r.get('/report/pdf', exportarRelatorioPdf);

// Relatório Excel de NF-es
// GET /api/nfes/report/excel?q=...&nfeStatus=...&dataIni=...&dataFim=...&sortBy=...&sortOrder=...
r.get('/report/excel', exportarRelatorioExcel);

// XML em LOTE (ZIP)
// GET /api/nfes/xml/lote
r.get('/xml/lote', downloadXmlLoteCtrl);

// ──────────────────────────────────────────────────────────────
// Rotas de diagnóstico / debug (mais específicas primeiro)
// ──────────────────────────────────────────────────────────────

// Diagnóstico de ambiente por tpAmb (alias antigo)
r.get('/diag/:id/ambiente', diagAmbiente);

// Diagnóstico de ambiente (handler principal)
r.get('/ambiente/:id/diagnostico', ambienteDiagnosticoCtrl);

// Config efetiva do conector
r.get('/debug/env', debugEnv);

// Dump das rotas registradas (debug)
r.get('/debug/routes', listRegisteredRoutes);

// DEBUG: força baixa de estoque por orderId
// GET /api/nfes/debug/baixa-estoque/135
r.get('/debug/baixa-estoque/:orderId(\\d+)', debugBaixaEstoque);

// ──────────────────────────────────────────────────────────────
// E-mail / anexos / arquivos individuais
// ──────────────────────────────────────────────────────────────

// Enviar NF-e por e-mail (PDF + XML)
// aceita:
// - id PlugNotas hex
// - chave 44 dígitos
// - orderId numérico
r.post('/:id([a-f0-9]{24,}|\\d{44}|\\d+)/email', sendNfeEmailCtrl);

// Resumo bruto de uma NF-e (id PlugNotas ou chave)
r.get('/:id([a-f0-9]{24,}|\\d{44})/resumo', getResumoCtrl);

// DANFE PDF por id/chave
r.get('/:id([a-f0-9]{24,}|\\d{44})/pdf', downloadDanfeCtrl);

// XML individual por id/chave
r.get('/:id([a-f0-9]{24,}|\\d{44})/xml', downloadXmlCtrl);

// ──────────────────────────────────────────────────────────────
// Rotas principais de NF-e (busca, reconcile, refresh)
// ──────────────────────────────────────────────────────────────

// Busca NF-e (tela nfes.html)
r.get('/search', searchNfes);

// Reconciliação / emissão idempotente a partir de um pedido
r.post('/reconcile/:orderId(\\d+)', reconcileNfe);

// Refresh de uma única NF-e (usando order_id)
r.post('/refresh/:orderId(\\d+)', refreshSingle);

// Alias novo: /api/nfes/:orderId/sync
r.post('/:orderId(\\d+)/sync', refreshSingle);

// Busca NF-e ligada a um pedido específico
r.get('/:orderId(\\d+)', getNfeByOrderId);

export default r;