// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: moduleDocsConsartController.js                         ║
// ║ MODULE: Documentação dos módulos (CONSART ERP)               ║
// ║ BASE: /api/module-docs-consart                               ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/moduleDocsConsart/moduleDocsConsart.repository.js';
import { generateModuleDocsConsartPdf } from '../generationPdf/generateModuleDocsConsartPdf.js';

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[moduleDocsConsartController] ${tag} error:`, error);
  return res.status(status).json({ ok: false, error: error?.message || 'Erro inesperado.' });
}

export async function list(req, res) {
  try {
    const { rows, summary } = await repo.list(req.query);
    return res.json({ ok: true, data: rows, summary });
  } catch (error) {
    return fail(res, 'list', error);
  }
}

export async function modules(req, res) {
  try {
    return res.json({ ok: true, data: await repo.listModules() });
  } catch (error) {
    return fail(res, 'modules', error);
  }
}

export async function getById(req, res) {
  try {
    const item = await repo.getById(req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
    return res.json({ ok: true, data: item });
  } catch (error) {
    return fail(res, 'getById', error);
  }
}

export async function save(req, res) {
  try {
    const user = req.user?.name || req.user?.email || null;
    const item = await repo.save(req.params.id, req.body, user);
    if (!item) return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
    return res.json({ ok: true, data: item });
  } catch (error) {
    return fail(res, 'save', error);
  }
}

/** DELETE /:id — exclui o módulo do sistema (não só a documentação) */
export async function remove(req, res) {
  try {
    const removed = await repo.removeModule(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
    return res.json({ ok: true, data: removed });
  } catch (error) {
    return fail(res, 'remove', error);
  }
}

/** GET /pdf?mesmos filtros da lista&showEmpty=0|1&showPaths=0|1&showNotes=0|1 */
export async function pdf(req, res) {
  try {
    const { rows, summary } = await repo.list(req.query);
    const modules = await repo.listModules();
    const moduleName = modules.find((m) => String(m.id) === String(req.query.module))?.name || '';
    const softwareName = String(req.query.software ?? '').toUpperCase() === 'NONE'
      ? 'Sem software'
      : (await repo.listSoftware()).find((sw) => String(sw.id) === String(req.query.software))?.name || '';

    const buffer = await generateModuleDocsConsartPdf({
      rows,
      summary,
      filters: { ...req.query, moduleName, softwareName },
      showEmpty: String(req.query.showEmpty ?? '1') !== '0',
      showPaths: String(req.query.showPaths ?? '1') !== '0',
      showNotes: String(req.query.showNotes ?? '1') !== '0',
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Documentacao_Modulos_${stamp}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(buffer);
  } catch (error) {
    return fail(res, 'pdf', error);
  }
}

// ── Softwares (cadastro) ─────────────────────────────────────────

export async function softwareList(req, res) {
  try {
    return res.json({ ok: true, data: await repo.listSoftware() });
  } catch (error) {
    return fail(res, 'softwareList', error);
  }
}

export async function softwareSave(req, res) {
  try {
    const item = await repo.saveSoftware(req.params.id || null, req.body);
    if (!item) return res.status(404).json({ ok: false, error: 'Software não encontrado.' });
    return res.status(req.params.id ? 200 : 201).json({ ok: true, data: item });
  } catch (error) {
    return fail(res, 'softwareSave', error);
  }
}

export async function softwareRemove(req, res) {
  try {
    const removed = await repo.removeSoftware(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Software não encontrado.' });
    return res.json({ ok: true, data: removed });
  } catch (error) {
    return fail(res, 'softwareRemove', error);
  }
}
