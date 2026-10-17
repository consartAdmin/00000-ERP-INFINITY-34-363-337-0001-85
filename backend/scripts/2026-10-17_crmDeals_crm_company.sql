-- CRM Consart ERP: separa os cards do "crmDeals" por empresa.
--   'BH3'     = CRM Gestão de Vendas (/crmDeals/crmDeals.html) — todos os cards atuais
--   'CONSART' = CRM Consart ERP      (/crmConsartErp/crmConsartErp.html)
-- O backend já roda isto sozinho ao subir (crmDealsSchema.repository.js);
-- este arquivo é só para rodar manualmente, se preferir.

ALTER TABLE public."crmDeals"
  ADD COLUMN IF NOT EXISTS crm_company VARCHAR(20) NOT NULL DEFAULT 'BH3';

CREATE INDEX IF NOT EXISTS idx_crmDeals_crm_company
  ON public."crmDeals"(crm_company);
