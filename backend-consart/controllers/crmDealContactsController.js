// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: crmDealContactsController.js                           ║
// ║ MODULE: CRM — contatos feitos no card (WhatsApp, Ligação,    ║
// ║         E-mail)                                              ║
// ║ BASE: /api/crm (crmDealsRoutes.js)                           ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/crmDealContacts/crmDealContacts.repository.js';
import { normalizeCrmCompany } from '../repositories/crmDeals/crmDeals.utils.js';

function crmCompany(req) {
  return normalizeCrmCompany(req.get('x-crm-company') || req.query.crmCompany);
}

function currentUser(req) {
  const u = req.user || {};
  return {
    id: u.user_id ?? u.id ?? null,
    name: u.name || u.username || u.user_name || u.login || null,
  };
}

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[crmDealContactsController] ${tag} error:`, error);
  return res.status(status).json({ ok: false, error: error?.message || 'Erro inesperado.' });
}

export async function summary(req, res) {
  try {
    return res.json({ ok: true, data: await repo.summary(crmCompany(req)) });
  } catch (error) {
    return fail(res, 'summary', error);
  }
}

export async function list(req, res) {
  try {
    return res.json({ ok: true, data: await repo.listByDeal(req.params.id, crmCompany(req)) });
  } catch (error) {
    return fail(res, 'list', error);
  }
}

export async function create(req, res) {
  try {
    const data = await repo.create(req.params.id, req.body, currentUser(req), crmCompany(req));
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return fail(res, 'create', error);
  }
}

export async function remove(req, res) {
  try {
    return res.json({ ok: true, data: await repo.remove(req.params.id, req.params.contactId, crmCompany(req)) });
  } catch (error) {
    return fail(res, 'remove', error);
  }
}
