// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmDealsRoutes.js — Rotas CRM Deals (CONSART ERP)                   ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import crmDealsController from '../controllers/crmDealsController.js';
import * as crmDealContacts from '../controllers/crmDealContactsController.js';
import { erpCompanyContext } from '../utils/erpCompanyContext.js';

const router = Router();

// Empresa da tela (BH3 x CONSART) também aqui, além do middleware global
router.use(erpCompanyContext);

/* =========================================================================
 * CATALOGS
 * ========================================================================= */

// STAGES
router.get('/stages', crmDealsController.listStages);

// STATUS TYPES
router.get('/status-types', crmDealsController.listStatusTypes);

// LEAD SOURCES
router.get('/lead-sources', crmDealsController.listLeadSources);

// DEAL OUTCOMES CATALOG
router.get('/deal-outcomes', crmDealsController.listDealOutcomes);

/* =========================================================================
 * DEALS
 * ========================================================================= */

router.get('/customer-locations', crmDealsController.listCustomerLocations);
router.get('/deals', crmDealsController.listDeals);
router.get('/deals/:id', crmDealsController.getDeal);
router.post('/deals', crmDealsController.createDeal);
router.post('/deals/from-customers', crmDealsController.createDealsFromCustomers);
router.patch('/deals/:id', crmDealsController.updateDeal);
router.patch('/deals/:id/move', crmDealsController.moveDeal);
router.delete('/deals/:id', crmDealsController.deleteDeal);

/* =========================================================================
 * CONTATOS DO CARD (WhatsApp / Ligação / E-mail)
 * ========================================================================= */

router.get('/deal-contacts/summary', crmDealContacts.summary);
router.get('/deals/:id/contacts', crmDealContacts.list);
router.post('/deals/:id/contacts', crmDealContacts.create);
router.delete('/deals/:id/contacts/:contactId', crmDealContacts.remove);

/* =========================================================================
 * CONCLUSÃO DO LEAD
 * ========================================================================= */

// fecha + status_type
router.patch('/deals/:id/status-type', crmDealsController.setDealStatusType);

// summary topo (fechados)
router.get('/conclusion/summary', crmDealsController.leadConclusionSummary);

/* =========================================================================
 * OUTCOMES
 * ========================================================================= */

router.post('/deals/:id/outcome', crmDealsController.registerOutcome);
router.get('/outcomes/summary', crmDealsController.summaryOutcomes);
router.get('/outcomes', crmDealsController.listOutcomes);

export default router;