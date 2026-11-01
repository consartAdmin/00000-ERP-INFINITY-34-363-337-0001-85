// ╔══════════════════════════════════════════════════════════════════════╗
// ║ appFeaturesAdminController.js — CRUD das telas de Funcionalidades    ║
// ║ API: /api/app-features-admin (features / options / assignments)     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import * as repo from '../repositories/appFeatures/appFeaturesAdmin.repository.js';

function isTrue(value) {
    return value === true || String(value).toLowerCase() === 'true';
}

// Erros do PostgreSQL traduzidos para mensagens da tela
function sendError(res, error) {
    console.error('[appFeaturesAdminController]', error);

    if (error.code === 'VALIDATION_ERROR') {
        return res.status(400).json({ ok: false, error: error.message });
    }
    if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ ok: false, error: error.message });
    }
    if (error.code === '23505') {
        return res.status(409).json({
            ok: false,
            error: 'Já existe um registro com esse código (ou essa funcionalidade já tem atribuição nesse escopo).',
        });
    }
    if (error.code === '23503') {
        return res.status(409).json({
            ok: false,
            error: 'Registro em uso: exclua (ou troque) primeiro as opções/atribuições ligadas a ele.',
        });
    }
    if (error.code === '23514' || error.code === '22P02') {
        return res.status(400).json({ ok: false, error: 'Valor inválido para um dos campos.' });
    }

    return res.status(500).json({ ok: false, error: 'Não foi possível processar a funcionalidade.' });
}

function handler(fn) {
    return async (req, res) => {
        try {
            const data = await fn(req);
            return res.json({ ok: true, data });
        } catch (error) {
            return sendError(res, error);
        }
    };
}

// Funcionalidades
export const listFeatures = handler((req) =>
    repo.listFeaturesAdmin({ includeInactive: isTrue(req.query.includeInactive) }));
export const createFeature = handler((req) => repo.createFeature(req.body));
export const updateFeature = handler((req) => repo.updateFeature(req.params.id, req.body));
export const deleteFeature = handler((req) => repo.deleteFeature(req.params.id));

// Opções
export const listOptions = handler((req) => repo.listOptionsAdmin({
    featureId: req.query.featureId || null,
    includeInactive: isTrue(req.query.includeInactive),
}));
export const createOption = handler((req) => repo.createOption(req.body));
export const updateOption = handler((req) => repo.updateOption(req.params.id, req.body));
export const deleteOption = handler((req) => repo.deleteOption(req.params.id));

// Atribuições
export const listAssignments = handler((req) =>
    repo.listAssignmentsAdmin({ featureId: req.query.featureId || null }));
export const createAssignment = handler((req) => repo.createAssignment(req.body));
export const updateAssignment = handler((req) => repo.updateAssignment(req.params.id, req.body));
export const deleteAssignment = handler((req) => repo.deleteAssignmentById(req.params.id));
