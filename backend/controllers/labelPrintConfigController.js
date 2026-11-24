// ╔══════════════════════════════════════════════════════════════════════╗
// ║ labelPrintConfigController.js — Controller Label Print Config        ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import labelPrintConfigApi from '../repositories/labelPrintConfig/labelPrintConfig.index.js';
import * as labelModels from '../repositories/labelPrintConfig/labelPrintModels.repository.js';

export async function getLabelConfig(req, res, next) {
  try {
    const row = await labelPrintConfigApi.getLabelConfig();

    if (!row) {
      return res.status(404).json({ error: 'Label print config not found' });
    }

    return res.json(row);
  } catch (err) {
    console.error('[labelPrintConfigController] getLabelConfig error:', err);
    return next(err);
  }
}

export async function updateLabelConfig(req, res, next) {
  try {
    const payload = { ...req.body };

    const updated = await labelPrintConfigApi.updateLabelConfig(payload);

    if (!updated) {
      return res.status(404).json({ error: 'Label print config not found' });
    }

    return res.json(updated);
  } catch (err) {
    console.error('[labelPrintConfigController] updateLabelConfig error:', err);

    if (err?.message) {
      return res.status(400).json({ error: err.message });
    }

    return next(err);
  }
}

export async function resetLabelConfig(req, res, next) {
  try {
    const reseted = await labelPrintConfigApi.resetLabelConfig();

    if (!reseted) {
      return res.status(404).json({ error: 'Label print config not found' });
    }

    return res.json(reseted);
  } catch (err) {
    console.error('[labelPrintConfigController] resetLabelConfig error:', err);
    return next(err);
  }
}
/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ Modelos de etiqueta de Localização (public."labelPrintModels")      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

function sendModelError(res, next, context, err) {
  console.error(`[labelPrintConfigController] ${context} error:`, err);
  if (err?.status === 400) return res.status(400).json({ error: err.message });
  return next(err);
}

function parseId(req) {
  const id = Number.parseInt(req.params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function listLabelModels(req, res, next) {
  try {
    const includeInactive = ['true', '1'].includes(String(req.query.includeInactive || ''));
    return res.json(await labelModels.listLabelModels({ includeInactive }));
  } catch (err) {
    return sendModelError(res, next, 'listLabelModels', err);
  }
}

export async function getDefaultLabelModel(req, res, next) {
  try {
    const row = await labelModels.getDefaultLabelModel();
    if (!row) return res.status(404).json({ error: 'Nenhum modelo de etiqueta cadastrado.' });
    return res.json(row);
  } catch (err) {
    return sendModelError(res, next, 'getDefaultLabelModel', err);
  }
}

export async function getLabelModel(req, res, next) {
  try {
    const id = parseId(req);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const row = await labelModels.getLabelModel(id);
    if (!row) return res.status(404).json({ error: 'Modelo não encontrado.' });
    return res.json(row);
  } catch (err) {
    return sendModelError(res, next, 'getLabelModel', err);
  }
}

export async function createLabelModel(req, res, next) {
  try {
    return res.status(201).json(await labelModels.createLabelModel(req.body || {}));
  } catch (err) {
    return sendModelError(res, next, 'createLabelModel', err);
  }
}

export async function updateLabelModel(req, res, next) {
  try {
    const id = parseId(req);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const row = await labelModels.updateLabelModel(id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Modelo não encontrado.' });
    return res.json(row);
  } catch (err) {
    return sendModelError(res, next, 'updateLabelModel', err);
  }
}

export async function setDefaultLabelModel(req, res, next) {
  try {
    const id = parseId(req);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const row = await labelModels.setDefaultLabelModel(id);
    if (!row) return res.status(404).json({ error: 'Modelo não encontrado.' });
    return res.json(row);
  } catch (err) {
    return sendModelError(res, next, 'setDefaultLabelModel', err);
  }
}

export async function deleteLabelModel(req, res, next) {
  try {
    const id = parseId(req);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const row = await labelModels.deleteLabelModel(id);
    if (!row) return res.status(404).json({ error: 'Modelo não encontrado.' });
    return res.json({ ok: true, id });
  } catch (err) {
    return sendModelError(res, next, 'deleteLabelModel', err);
  }
}
