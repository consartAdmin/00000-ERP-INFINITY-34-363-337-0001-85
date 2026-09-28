-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CORREÇÕES DE SCHEMA — erp-infinity-00001                           ║
-- ║ Gerado a partir da auditoria real do banco em 16/09/2026           ║
-- ║ PostgreSQL 17.11 · 274 tabelas em public                           ║
-- ║                                                                    ║
-- ║ ⚠ NADA AQUI FOI EXECUTADO. Revise bloco por bloco.                 ║
-- ║                                                                    ║
-- ║ Ordem sugerida: 1 → 2 → 3 → (4 e 5 só depois de conferir)          ║
-- ╚════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════
-- BLOCO 1 · ANALYZE — RISCO ZERO, MAIOR GANHO
--
-- 69 tabelas nunca passaram por ANALYZE, incluindo TODO o caminho quente
-- da emissão de NF-e: nfeStatusMap, nfeOperationTypes,
-- fiscal_classification_v2 e fiscal_profile_v2. Sem estatística, o
-- planejador escolhe plano às cegas.
--
-- Não bloqueia escrita, não altera dados. Pode rodar em produção.
-- ════════════════════════════════════════════════════════════════════

ANALYZE VERBOSE public."nfeStatusMap";
ANALYZE VERBOSE public."nfeOperationTypes";
ANALYZE VERBOSE public.fiscal_classification_v2;
ANALYZE VERBOSE public.fiscal_profile_v2;
ANALYZE VERBOSE public.products_fiscal_v2;
ANALYZE VERBOSE public."budgetsNfeAttempts";
ANALYZE VERBOSE public."budgetsNfeAttemptItems";
ANALYZE VERBOSE public."invoicesIssued";
ANALYZE VERBOSE public."inboundInvoiceItems";
ANALYZE VERBOSE public."productsStockLots";
ANALYZE VERBOSE public."accountsReceivable";
ANALYZE VERBOSE public."accountsReceivableAsaas";

-- Ou, resolvendo o banco inteiro de uma vez (recomendado, leva segundos
-- num banco deste tamanho — a maior tabela tem 3,8 MB):
-- ANALYZE;


-- ════════════════════════════════════════════════════════════════════
-- BLOCO 2 · PRIMARY KEY FALTANDO EM budgetsNfeAttemptItems
--
-- A coluna attempt_item_id já é IDENTITY ALWAYS (bigint NOT NULL), mas
-- não há PK nem UNIQUE declarada. A tabela tem 11 índices e 1 FK —
-- falta só a chave primária.
--
-- Impacto de não ter: impede replicação lógica, dificulta UPDATE/DELETE
-- por linha e deixa a tabela sem identidade formal.
-- ════════════════════════════════════════════════════════════════════

-- 2.1 CONFIRA PRIMEIRO — precisa retornar ZERO linhas:
SELECT attempt_item_id, count(*)
FROM public."budgetsNfeAttemptItems"
GROUP BY attempt_item_id
HAVING count(*) > 1;

-- 2.2 Se o passo 2.1 voltou vazio, aplique (652 linhas — instantâneo):
ALTER TABLE public."budgetsNfeAttemptItems"
  ADD CONSTRAINT "budgetsNfeAttemptItems_pkey"
  PRIMARY KEY (attempt_item_id);

-- 2.3 Considere o mesmo para ordersNfeAttemptItems (mesmo padrão de tabela):
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public."ordersNfeAttemptItems"'::regclass;


-- ════════════════════════════════════════════════════════════════════
-- BLOCO 3 · ÍNDICES PARA FOREIGN KEYS  (61 no total)
--
-- Sem índice na coluna filha, todo DELETE/UPDATE na tabela pai faz
-- varredura completa da filha. É a causa mais comum de lentidão que
-- "aparece do nada" quando a tabela cresce.
--
-- Todas as tabelas aqui são pequenas (< 4 MB), então CREATE INDEX comum
-- é instantâneo e o bloqueio é imperceptível. Se alguma crescer muito,
-- troque por CREATE INDEX CONCURRENTLY (que NÃO pode rodar dentro de
-- transação — rode fora de BEGIN/COMMIT).
-- ════════════════════════════════════════════════════════════════════

-- ─── 3.1 FINANCEIRO — caminho NF-e autorizada → contas a receber → Asaas
CREATE INDEX IF NOT EXISTS "ix_accountsReceivableAsaas_accounts_receivable_id" ON "accountsReceivableAsaas" (accounts_receivable_id);
CREATE INDEX IF NOT EXISTS "ix_accountsReceivableManualBoletos_accounts_receivable_id" ON "accountsReceivableManualBoletos" (accounts_receivable_id);
CREATE INDEX IF NOT EXISTS "ix_accountsReceivable_customer_id" ON "accountsReceivable" (customer_id);
CREATE INDEX IF NOT EXISTS "ix_accountsReceivable_category_id" ON "accountsReceivable" (category_id);
CREATE INDEX IF NOT EXISTS "ix_accountsReceivable_subcategory_id" ON "accountsReceivable" (subcategory_id);
CREATE INDEX IF NOT EXISTS "ix_accountsReceivable_document_type_id" ON "accountsReceivable" (document_type_id);
CREATE INDEX IF NOT EXISTS "ix_accountsPayable_supplier_id" ON "accountsPayable" (supplier_id);
CREATE INDEX IF NOT EXISTS "ix_accountsPayable_category_id" ON "accountsPayable" (category_id);
CREATE INDEX IF NOT EXISTS "ix_accountsPayable_subcategory_id" ON "accountsPayable" (subcategory_id);
CREATE INDEX IF NOT EXISTS "ix_accountsPayable_payment_method_id" ON "accountsPayable" (payment_method_id);
CREATE INDEX IF NOT EXISTS "ix_accountsPayable_inbound_invoice_id" ON "accountsPayable" (inbound_invoice_id);
CREATE INDEX IF NOT EXISTS "ix_ordersPaymentInstallments_order_payment_id" ON "ordersPaymentInstallments" (order_payment_id);

-- ─── 3.2 FISCAL
CREATE INDEX IF NOT EXISTS ix_sped_fiscal_inconsistencias_lote_id ON sped_fiscal_inconsistencias (lote_id);
CREATE INDEX IF NOT EXISTS "ix_fiscalApuracaoReconciliation_fiscal_apuracao_item_id" ON "fiscalApuracaoReconciliation" (fiscal_apuracao_item_id);
CREATE INDEX IF NOT EXISTS "ix_salesTaxCalculationItems_sales_tax_calc_id" ON "salesTaxCalculationItems" (sales_tax_calc_id);
CREATE INDEX IF NOT EXISTS "ix_usoConsumoItems_uso_consumo_id" ON "usoConsumoItems" (uso_consumo_id);
CREATE INDEX IF NOT EXISTS "ix_supplierReturnNfeItems_return_id" ON "supplierReturnNfeItems" (return_id);
CREATE INDEX IF NOT EXISTS "ix_nfeBonus_operation_type_id" ON "nfeBonus" (operation_type_id);
CREATE INDEX IF NOT EXISTS "ix_nfeBonusItems_product_grade_id" ON "nfeBonusItems" (product_grade_id);
CREATE INDEX IF NOT EXISTS "ix_fiscalClassification_fiscal_profile_id" ON "fiscalClassification" (fiscal_profile_id);
CREATE INDEX IF NOT EXISTS "ix_productsFiscal_fiscal_profile_id" ON "productsFiscal" (fiscal_profile_id);
CREATE INDEX IF NOT EXISTS "ix_productsFiscal_fiscal_classification_id" ON "productsFiscal" (fiscal_classification_id);

-- ─── 3.3 ESTOQUE E LOGÍSTICA
CREATE INDEX IF NOT EXISTS "ix_inventoryItems_lot_id" ON "inventoryItems" (lot_id);
CREATE INDEX IF NOT EXISTS ix_inventories_created_by ON inventories (created_by);
CREATE INDEX IF NOT EXISTS ix_inventories_finalized_by ON inventories (finalized_by);
CREATE INDEX IF NOT EXISTS "ix_locationsBarCode_local_id" ON "locationsBarCode" (local_id);
CREATE INDEX IF NOT EXISTS "ix_locationsBarCode_corridor_id" ON "locationsBarCode" (corridor_id);
CREATE INDEX IF NOT EXISTS "ix_locationsBarCode_shelf_id" ON "locationsBarCode" (shelf_id);
CREATE INDEX IF NOT EXISTS "ix_locationsBarCode_bin_id" ON "locationsBarCode" (bin_id);
CREATE INDEX IF NOT EXISTS "ix_locationsBarCode_position_id" ON "locationsBarCode" (position_id);

-- ─── 3.4 VENDAS / PEDIDOS / CRM
CREATE INDEX IF NOT EXISTS ix_orders_price_id ON orders (price_id);
CREATE INDEX IF NOT EXISTS "ix_ordersKanbanCards_customer_id" ON "ordersKanbanCards" (customer_id);
CREATE INDEX IF NOT EXISTS "ix_salesCommissionsFromInvoices_commission_id" ON "salesCommissionsFromInvoices" (commission_id);
CREATE INDEX IF NOT EXISTS "ix_crmDeals_status_type_id" ON "crmDeals" (status_type_id);
CREATE INDEX IF NOT EXISTS "ix_crmDeals_loss_reason_id" ON "crmDeals" (loss_reason_id);
CREATE INDEX IF NOT EXISTS "ix_crmDeals_outcome_id" ON "crmDeals" (outcome_id);
CREATE INDEX IF NOT EXISTS "ix_crmDeals_lead_source_id" ON "crmDeals" (lead_source_id);
CREATE INDEX IF NOT EXISTS "ix_customerActivity_crm_deals_outcome_id" ON "customerActivity" (crm_deals_outcome_id);
CREATE INDEX IF NOT EXISTS "ix_betterDateToBuy_customer_id" ON "betterDateToBuy" (customer_id);

-- ─── 3.5 OUTROS MÓDULOS (menor prioridade)
CREATE INDEX IF NOT EXISTS "ix_appFeatureAssignments_feature_id" ON "appFeatureAssignments" (feature_id);
CREATE INDEX IF NOT EXISTS "ix_expensesSubcategories_category_id" ON "expensesSubcategories" (category_id);
CREATE INDEX IF NOT EXISTS ix_debts_parent_debt_id ON debts (parent_debt_id);
CREATE INDEX IF NOT EXISTS ix_debt_attachments_debt_id ON debt_attachments (debt_id);
CREATE INDEX IF NOT EXISTS "ix_emailSignatures_owneruserid" ON "emailSignatures" (owneruserid);
CREATE INDEX IF NOT EXISTS "ix_ecommerceCustomerPaymentMethods_payment_method_id" ON "ecommerceCustomerPaymentMethods" (payment_method_id);
CREATE INDEX IF NOT EXISTS ix_roleta_tokens_campaign_id ON roleta_tokens (campaign_id);

-- ─── 3.6 GOOGLE ADS (tabelas de métricas — só se usar o módulo)
CREATE INDEX IF NOT EXISTS "ix_googleAdsOauthTokens_account_id" ON "googleAdsOauthTokens" (account_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsSyncLogs_account_id" ON "googleAdsSyncLogs" (account_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsErpAttribution_campaign_id" ON "googleAdsErpAttribution" (campaign_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsErpAttribution_ad_group_id" ON "googleAdsErpAttribution" (ad_group_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsAdDaily_campaign_id" ON "googleAdsMetricsAdDaily" (campaign_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsAdDaily_ad_group_id" ON "googleAdsMetricsAdDaily" (ad_group_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsKeywordDaily_campaign_id" ON "googleAdsMetricsKeywordDaily" (campaign_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsKeywordDaily_ad_group_id" ON "googleAdsMetricsKeywordDaily" (ad_group_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsDeviceDaily_ad_group_id" ON "googleAdsMetricsDeviceDaily" (ad_group_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsGeoDaily_campaign_id" ON "googleAdsMetricsGeoDaily" (campaign_id);
CREATE INDEX IF NOT EXISTS "ix_googleAdsMetricsTimeDaily_campaign_id" ON "googleAdsMetricsTimeDaily" (campaign_id);


-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ OS BLOCOS 4 E 5 SÃO DESTRUTIVOS.                                   ║
-- ║ Estão COMENTADOS de propósito. Só descomente após conferir.        ║
-- ╚════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════
-- BLOCO 4 · FOREIGN KEYS DUPLICADAS
--
-- productsFiscal e productsFiscalAncient têm DUAS FKs para as mesmas
-- colunas — provavelmente sobra de renomeação de tabela. Cada FK
-- duplicada cobra verificação extra em todo INSERT/UPDATE.
-- ════════════════════════════════════════════════════════════════════

-- 4.1 CONFIRA — veja as duplicatas antes de remover:
SELECT
  conrelid::regclass::text     AS tabela,
  conname                      AS restricao,
  pg_get_constraintdef(oid)    AS definicao
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid IN (
    'public."productsFiscal"'::regclass,
    'public."productsFiscalAncient"'::regclass
  )
ORDER BY tabela, pg_get_constraintdef(oid), conname;

-- 4.2 Remova apenas a duplicata (mantenha uma de cada par).
--     Os nomes em minúsculas parecem ser os antigos:
-- ALTER TABLE public."productsFiscalAncient"
--   DROP CONSTRAINT IF EXISTS productsfiscal_fiscal_profile_fkey;
-- ALTER TABLE public."productsFiscalAncient"
--   DROP CONSTRAINT IF EXISTS productsfiscal_fiscal_classification_fkey;


-- ════════════════════════════════════════════════════════════════════
-- BLOCO 5 · TABELAS LEGADAS / BACKUP  (12 tabelas, ~3,3 MB)
--
-- 7 delas são as "tabelas sem PK" do relatório. Não atrapalham o
-- funcionamento, mas poluem a árvore do pgAdmin e a auditoria.
--
-- ⚠ Confirme que já existe backup no Cloud SQL antes de qualquer DROP
--   (use o execute_to_export_sql.html do projeto).
-- ════════════════════════════════════════════════════════════════════

-- 5.1 CONFIRA — o que existe e desde quando:
SELECT
  c.relname                                     AS tabela,
  c.reltuples::bigint                           AS linhas,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname ~* '(backup|_old|_ancient|desativado|_bkp)'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- 5.2 Candidatas a remoção (datadas — presumivelmente já cumpriram o papel):
-- DROP TABLE IF EXISTS public."paymentMethods_backup_20260814";
-- DROP TABLE IF EXISTS public."paymentMethods_backup";
-- DROP TABLE IF EXISTS public."products_barcode_inactive_backup_20260716";
-- DROP TABLE IF EXISTS public."transporters_backup_20260910";
-- DROP TABLE IF EXISTS public."productsStockLots_backup_20260821";
-- DROP TABLE IF EXISTS public."moduleSystem_backup_20260815";
-- DROP TABLE IF EXISTS public."productsPrices_backup_20260910";
-- DROP TABLE IF EXISTS public."productsStock_backup_before_simple_inbound_20260910";
-- DROP TABLE IF EXISTS public.products_fiscal_v2_initial_backup;

-- 5.3 Estas exigem MAIS cuidado — há FKs apontando para productsFiscalAncient
--     e productsUnits_* pode ainda ser lida por código legado. Rode a busca
--     no código antes:  grep -rn "productsUnits_old\|productsUnits_desativado" backend/
-- DROP TABLE IF EXISTS public."productsUnits_desativado";
-- DROP TABLE IF EXISTS public."productsUnits_old";
-- DROP TABLE IF EXISTS public."productsFiscalAncient";


-- ════════════════════════════════════════════════════════════════════
-- BLOCO 6 · VERIFICAÇÃO PÓS-APLICAÇÃO
-- Rode depois dos blocos 1–3. O ideal é tudo voltar ZERO.
-- ════════════════════════════════════════════════════════════════════

-- 6.1 Ainda há FK sem índice? (esperado: 0, ou só as de tabelas legadas)
SELECT con.conrelid::regclass::text AS tabela, con.conname AS fk
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = con.conrelid AND i.indkey[0] = con.conkey[1]
  )
ORDER BY 1;

-- 6.2 Ainda há tabela sem PK? (esperado: só backups)
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p')
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary
  )
ORDER BY 1;

-- 6.3 Ainda há tabela sem estatística? (esperado: 0)
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p')
  AND c.reltuples = -1
ORDER BY 1;
