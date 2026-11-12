// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashFiscalDocumentsController.js — NF-e/NFS-e x pagamentos do Caixa  ║
// ║ CONSART ERP — ESM                                                    ║
// ║ Rotas em /api/caixa/notas-fiscais (cashMovimentsRoutes.js)           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import multer from 'multer';
import { Storage } from '@google-cloud/storage';
import {
  cleanIds,
  listFiscalDocuments,
  getFiscalDocument,
  listPaymentsByIds,
  createFiscalDocument,
  updateFiscalDocument,
  linkPaymentsToDocument,
  unlinkPayments,
  deleteFiscalDocument,
  addFiscalDocumentAttachment,
  deleteFiscalDocumentAttachment,
  fiscalDocumentExists,
} from '../repositories/cashFiscalDocuments/cashFiscalDocuments.repository.js';

const BUCKET_NAME = String(process.env.GCS_BUCKET || 'erp-infinity-00000')
  .trim()
  .replace(/^gs:\/\//i, '')
  .replace(/\/+$/g, '');
const PREFIX = 'cashFiscalDocuments';
const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

const storage = new Storage(PROJECT_ID ? { projectId: PROJECT_ID } : undefined);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const pad2 = (n) => String(n).padStart(2, '0');

function slugifyName(name) {
  return String(name || 'arquivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function buildObjectPath(docId, originalName, date = new Date()) {
  const ts = Math.floor(Date.now() / 1000);
  return `${PREFIX}/${date.getFullYear()}/${pad2(date.getMonth() + 1)}/nota-${docId}/${ts}-${slugifyName(originalName)}`;
}

function validId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sendError(res, tag, err) {
  console.error(`[NOTAS_FISCAIS][${tag}][ERR]`, err);
  return res.status(err?.status || 500).json({
    ok: false,
    error: err?.status ? err.message : 'Falha ao processar a nota fiscal.',
  });
}

async function removeFromBucket(anexos = []) {
  for (const a of anexos) {
    if (!a?.storage_path) continue;
    await storage
      .bucket(a.storage_bucket || BUCKET_NAME)
      .file(a.storage_path)
      .delete({ ignoreNotFound: true })
      .catch((err) => console.warn('[NOTAS_FISCAIS][GCS_DELETE]', a.storage_path, err?.message));
  }
}

/* =========================================================================
   NOTAS
============================================================================*/

export async function listNotas(req, res) {
  try {
    const rows = await listFiscalDocuments({
      search: req.query.search ?? req.query.q,
      limit: req.query.limit,
    });
    return res.json({ ok: true, rows });
  } catch (err) {
    return sendError(res, 'LIST', err);
  }
}

export async function getNota(req, res) {
  try {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

    const nota = await getFiscalDocument(id);
    if (!nota) return res.status(404).json({ ok: false, error: 'Nota não encontrada.' });

    return res.json({ ok: true, nota });
  } catch (err) {
    return sendError(res, 'GET', err);
  }
}

export async function listPagamentos(req, res) {
  try {
    const rows = await listPaymentsByIds(req.query.ids);
    return res.json({ ok: true, rows });
  } catch (err) {
    return sendError(res, 'PAGAMENTOS', err);
  }
}

export async function createNota(req, res) {
  try {
    const nota = await createFiscalDocument(req.body || {});
    return res.status(201).json({ ok: true, nota });
  } catch (err) {
    return sendError(res, 'CREATE', err);
  }
}

export async function updateNota(req, res) {
  try {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

    const nota = await updateFiscalDocument(id, req.body || {});
    if (!nota) return res.status(404).json({ ok: false, error: 'Nota não encontrada.' });

    return res.json({ ok: true, nota });
  } catch (err) {
    return sendError(res, 'UPDATE', err);
  }
}

export async function vincularPagamentos(req, res) {
  try {
    const id = validId(req.params.id);
    const ids = cleanIds(req.body?.ids ?? req.body?.movement_ids);
    if (!id || !ids.length) {
      return res.status(400).json({ ok: false, error: 'Informe a nota e os pagamentos.' });
    }

    const result = await linkPaymentsToDocument(id, ids);
    if (!result) return res.status(404).json({ ok: false, error: 'Nota não encontrada.' });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return sendError(res, 'VINCULAR', err);
  }
}

export async function desvincularPagamentos(req, res) {
  try {
    const ids = cleanIds(req.body?.ids ?? req.body?.movement_ids);
    if (!ids.length) {
      return res.status(400).json({ ok: false, error: 'Informe os pagamentos.' });
    }

    const unlinked = await unlinkPayments(ids);
    return res.json({ ok: true, unlinked });
  } catch (err) {
    return sendError(res, 'DESVINCULAR', err);
  }
}

export async function deleteNota(req, res) {
  try {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

    const result = await deleteFiscalDocument(id);
    if (!result) return res.status(404).json({ ok: false, error: 'Nota não encontrada.' });

    await removeFromBucket(result.anexos);
    return res.json({ ok: true, deleted: true });
  } catch (err) {
    return sendError(res, 'DELETE', err);
  }
}

/* =========================================================================
   ANEXOS DA NOTA
============================================================================*/

async function handleUploadAnexoNota(req, res) {
  let objectName = null;

  try {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Arquivo ausente (campo "arquivo").' });
    }
    if (!(await fiscalDocumentExists(id))) {
      return res.status(404).json({ ok: false, error: 'Nota não encontrada.' });
    }

    objectName = buildObjectPath(id, req.file.originalname);

    await storage.bucket(BUCKET_NAME).file(objectName).save(req.file.buffer, {
      resumable: false,
      contentType: req.file.mimetype || 'application/octet-stream',
      metadata: {
        cacheControl: 'no-store',
        metadata: {
          module: PREFIX,
          fiscal_document_id: String(id),
          originalName: req.file.originalname || '',
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });

    const anexo = await addFiscalDocumentAttachment({
      fiscal_document_id: id,
      file_name: req.file.originalname || 'arquivo',
      mime_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      storage_bucket: BUCKET_NAME,
      storage_path: objectName,
    });

    return res.status(201).json({ ok: true, anexo });
  } catch (err) {
    if (objectName) {
      await removeFromBucket([{ storage_bucket: BUCKET_NAME, storage_path: objectName }]);
    }
    return sendError(res, 'UPLOAD', err);
  }
}

function uploadSingleArquivo(req, res, next) {
  upload.single('arquivo')(req, res, (err) => {
    if (!err) return next();
    console.error('[NOTAS_FISCAIS][MULTER]', err);
    return res.status(400).json({ ok: false, error: 'Arquivo inválido para upload.' });
  });
}

export const uploadAnexoNota = [uploadSingleArquivo, handleUploadAnexoNota];

export async function deleteAnexoNota(req, res) {
  try {
    const id = validId(req.params.id);
    const anexoId = validId(req.params.anexoId);
    if (!id || !anexoId) return res.status(400).json({ ok: false, error: 'ids inválidos' });

    const removed = await deleteFiscalDocumentAttachment(id, anexoId);
    if (!removed) return res.status(404).json({ ok: false, error: 'Anexo não encontrado.' });

    await removeFromBucket([removed]);
    return res.json({ ok: true, deleted: true });
  } catch (err) {
    return sendError(res, 'DELETE_ANEXO', err);
  }
}
