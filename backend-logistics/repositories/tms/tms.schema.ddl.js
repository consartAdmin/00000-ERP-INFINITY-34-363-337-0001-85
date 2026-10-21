/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: tms.schema.ddl.js                                             ║
   ║ MODULE: Transporte (TMS)                                            ║
   ║ DESCRIPTION: DDL idempotente das tabelas do TMS. Fica em .js (e não ║
   ║   .sql) porque o .gitignore do projeto ignora *.sql.                ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

export const TMS_DDL = String.raw`
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ tms.schema.ddl — Módulos de Transporte (TMS) · CONSART LOGISTICS     ║
-- ║ DDL idempotente: pode ser executado mais de uma vez.                  ║
-- ║ A API roda este arquivo sozinha ao subir (tms.schema.js); também      ║
-- ║ pode ser rodado à mão no pgAdmin / psql.                              ║
-- ║ Depende de: drivers, vehicles, deliveryTrips (deliveryTrips.schema.js)║
-- ║                                                                      ║
-- ║ Documentos fiscais : tmsInsurancePolicies, tmsCte, tmsCteDocuments,   ║
-- ║                      tmsCteComponents, tmsCteEvents, tmsMdfe,         ║
-- ║                      tmsMdfeDocuments                                 ║
-- ║ Comercial          : tmsFreightTables, tmsFreightTableRanges,         ║
-- ║                      tmsFreightQuotes, tmsPickupOrders,               ║
-- ║                      tmsFreightInvoices, tmsFreightInvoiceItems,      ║
-- ║                      tmsEdiFiles                                      ║
-- ║ Operação           : tmsLoadPlans, tmsLoadPlanItems,                  ║
-- ║                      tmsDriverContracts, tmsDriverJourneys,           ║
-- ║                      tmsTripExpenses                                  ║
-- ║ Frota              : tmsMaintenancePlans, tmsWorkOrders, tmsTires,    ║
-- ║                      tmsTireMovements, tmsFuelEntries,                ║
-- ║                      tmsVehicleDocuments, tmsTrafficFines             ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fn_tms_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ═════════════════════════ DOCUMENTOS FISCAIS ═════════════════════════

-- Apólices de seguro de carga (averbação RCTR-C / RC-DC)
CREATE TABLE IF NOT EXISTS public."tmsInsurancePolicies" (
  policy_id        SERIAL PRIMARY KEY,
  insurer_name     VARCHAR(150) NOT NULL,
  insurer_cnpj     VARCHAR(18),
  policy_number    VARCHAR(40) NOT NULL,
  coverage         VARCHAR(20) NOT NULL DEFAULT 'RCTR-C'
                   CONSTRAINT "tmsInsurancePolicies_coverage_check" CHECK (coverage IN ('RCTR-C','RC-DC','RCF-DC','OUTROS')),
  responsible      VARCHAR(20) NOT NULL DEFAULT 'EMITENTE'
                   CONSTRAINT "tmsInsurancePolicies_responsible_check" CHECK (responsible IN ('EMITENTE','TOMADOR')),
  endorser         VARCHAR(60),
  valid_from       DATE,
  valid_until      DATE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CT-e (modelo 57)
CREATE TABLE IF NOT EXISTS public."tmsCte" (
  cte_id               BIGSERIAL PRIMARY KEY,
  series               INTEGER NOT NULL DEFAULT 1,
  number               INTEGER,
  access_key           VARCHAR(44),
  cte_type             VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
                       CONSTRAINT "tmsCte_type_check" CHECK (cte_type IN ('NORMAL','COMPLEMENTAR','ANULACAO','SUBSTITUTO')),
  service_type         VARCHAR(30) NOT NULL DEFAULT 'NORMAL'
                       CONSTRAINT "tmsCte_service_check" CHECK (service_type IN ('NORMAL','SUBCONTRATACAO','REDESPACHO','REDESPACHO_INTERMEDIARIO','MULTIMODAL')),
  cfop                 VARCHAR(4),
  nature               VARCHAR(80) NOT NULL DEFAULT 'PRESTACAO DE SERVICO DE TRANSPORTE',
  issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  status               VARCHAR(20) NOT NULL DEFAULT 'DIGITADO'
                       CONSTRAINT "tmsCte_status_check" CHECK (status IN ('DIGITADO','EMITIDO','AUTORIZADO','CANCELADO')),
  payer_role           VARCHAR(20) NOT NULL DEFAULT 'REMETENTE'
                       CONSTRAINT "tmsCte_payer_role_check" CHECK (payer_role IN ('REMETENTE','EXPEDIDOR','RECEBEDOR','DESTINATARIO','OUTROS')),
  sender_customer_id   INTEGER,
  sender_name          VARCHAR(200),
  sender_tax_id        VARCHAR(20),
  sender_city          VARCHAR(120),
  sender_state         VARCHAR(2),
  recipient_customer_id INTEGER,
  recipient_name       VARCHAR(200),
  recipient_tax_id     VARCHAR(20),
  recipient_address    VARCHAR(300),
  recipient_city       VARCHAR(120),
  recipient_state      VARCHAR(2),
  payer_customer_id    INTEGER,
  payer_name           VARCHAR(200),
  payer_tax_id         VARCHAR(20),
  origin_city          VARCHAR(120),
  origin_state         VARCHAR(2),
  destination_city     VARCHAR(120),
  destination_state    VARCHAR(2),
  cargo_description    VARCHAR(120),
  cargo_value          NUMERIC(14,2),
  weight_kg            NUMERIC(12,3),
  volumes              INTEGER,
  cubage_m3            NUMERIC(12,3),
  freight_table_id     INTEGER,
  quote_id             BIGINT,
  trip_id              BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  vehicle_id           INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  driver_id            INTEGER REFERENCES public."drivers"(driver_id) ON DELETE SET NULL,
  freight_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
  icms_cst             VARCHAR(3),
  icms_base            NUMERIC(14,2),
  icms_rate            NUMERIC(6,2),
  icms_amount          NUMERIC(14,2),
  delivery_status      VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
                       CONSTRAINT "tmsCte_delivery_status_check" CHECK (delivery_status IN ('PENDENTE','EM_TRANSITO','ENTREGUE','OCORRENCIA','DEVOLVIDO')),
  delivered_at         TIMESTAMPTZ,
  policy_id            INTEGER REFERENCES public."tmsInsurancePolicies"(policy_id) ON DELETE SET NULL,
  insurance_status     VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
                       CONSTRAINT "tmsCte_insurance_status_check" CHECK (insurance_status IN ('PENDENTE','AVERBADO','NAO_SE_APLICA')),
  insurance_number     VARCHAR(60),
  insurance_protocol   VARCHAR(60),
  insured_at           TIMESTAMPTZ,
  sefaz_protocol       VARCHAR(30),
  authorized_at        TIMESTAMPTZ,
  cancel_reason        TEXT,
  canceled_at          TIMESTAMPTZ,
  notes                TEXT,
  created_by           INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tmsCte_series_number_uq" ON public."tmsCte" (series, number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tmsCte_issue_date_idx" ON public."tmsCte" (issue_date DESC);
CREATE INDEX IF NOT EXISTS "tmsCte_trip_idx" ON public."tmsCte" (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tmsCte_payer_idx" ON public."tmsCte" (payer_customer_id);

-- Documentos transportados (NF-e / NF / outros)
CREATE TABLE IF NOT EXISTS public."tmsCteDocuments" (
  doc_id           BIGSERIAL PRIMARY KEY,
  cte_id           BIGINT NOT NULL REFERENCES public."tmsCte"(cte_id) ON DELETE CASCADE,
  doc_type         VARCHAR(10) NOT NULL DEFAULT 'NFE'
                   CONSTRAINT "tmsCteDocuments_type_check" CHECK (doc_type IN ('NFE','NF','OUTROS')),
  access_key       VARCHAR(44),
  number           VARCHAR(20),
  series           VARCHAR(5),
  issue_date       DATE,
  amount           NUMERIC(14,2),
  weight_kg        NUMERIC(12,3),
  volumes          INTEGER
);
CREATE INDEX IF NOT EXISTS "tmsCteDocuments_cte_idx" ON public."tmsCteDocuments" (cte_id);

-- Componentes do valor da prestação (frete peso, ad valorem, GRIS, pedágio...)
CREATE TABLE IF NOT EXISTS public."tmsCteComponents" (
  component_id     BIGSERIAL PRIMARY KEY,
  cte_id           BIGINT NOT NULL REFERENCES public."tmsCte"(cte_id) ON DELETE CASCADE,
  name             VARCHAR(40) NOT NULL,
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "tmsCteComponents_cte_idx" ON public."tmsCteComponents" (cte_id);

-- Ocorrências de entrega (códigos OCOREN / PROCEDA)
CREATE TABLE IF NOT EXISTS public."tmsCteEvents" (
  event_id         BIGSERIAL PRIMARY KEY,
  cte_id           BIGINT NOT NULL REFERENCES public."tmsCte"(cte_id) ON DELETE CASCADE,
  event_type       VARCHAR(30) NOT NULL DEFAULT 'EM_TRANSITO'
                   CONSTRAINT "tmsCteEvents_type_check" CHECK (event_type IN ('COLETADO','EM_TRANSITO','SAIU_PARA_ENTREGA','ENTREGUE','RECUSADO','ENDERECO_NAO_ENCONTRADO','DESTINATARIO_AUSENTE','AVARIA','EXTRAVIO','DEVOLVIDO','OUTROS')),
  event_code       VARCHAR(3),
  event_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  location         VARCHAR(150),
  received_by      VARCHAR(150),
  received_doc     VARCHAR(30),
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsCteEvents_cte_idx" ON public."tmsCteEvents" (cte_id, event_at DESC);

-- MDF-e (modelo 58)
CREATE TABLE IF NOT EXISTS public."tmsMdfe" (
  mdfe_id          BIGSERIAL PRIMARY KEY,
  series           INTEGER NOT NULL DEFAULT 1,
  number           INTEGER,
  access_key       VARCHAR(44),
  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'DIGITADO'
                   CONSTRAINT "tmsMdfe_status_check" CHECK (status IN ('DIGITADO','EMITIDO','AUTORIZADO','ENCERRADO','CANCELADO')),
  origin_state     VARCHAR(2),
  destination_state VARCHAR(2),
  route_states     VARCHAR(100),
  loading_city     VARCHAR(120),
  unloading_city   VARCHAR(120),
  vehicle_id       INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  trailer_plates   VARCHAR(60),
  driver_id        INTEGER REFERENCES public."drivers"(driver_id) ON DELETE SET NULL,
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  ciot_number      VARCHAR(20),
  toll_voucher_number VARCHAR(30),
  total_cargo_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_weight_kg  NUMERIC(12,3) NOT NULL DEFAULT 0,
  cte_count        INTEGER NOT NULL DEFAULT 0,
  closing_city     VARCHAR(120),
  closing_state    VARCHAR(2),
  closed_at        TIMESTAMPTZ,
  sefaz_protocol   VARCHAR(30),
  authorized_at    TIMESTAMPTZ,
  cancel_reason    TEXT,
  canceled_at      TIMESTAMPTZ,
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tmsMdfe_series_number_uq" ON public."tmsMdfe" (series, number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tmsMdfe_issue_date_idx" ON public."tmsMdfe" (issue_date DESC);

CREATE TABLE IF NOT EXISTS public."tmsMdfeDocuments" (
  item_id          BIGSERIAL PRIMARY KEY,
  mdfe_id          BIGINT NOT NULL REFERENCES public."tmsMdfe"(mdfe_id) ON DELETE CASCADE,
  cte_id           BIGINT NOT NULL REFERENCES public."tmsCte"(cte_id) ON DELETE RESTRICT,
  CONSTRAINT "tmsMdfeDocuments_uq" UNIQUE (mdfe_id, cte_id)
);
CREATE INDEX IF NOT EXISTS "tmsMdfeDocuments_cte_idx" ON public."tmsMdfeDocuments" (cte_id);

-- ═════════════════════════ COMERCIAL ═════════════════════════

-- Tabelas de frete (por faixa de peso, km ou valor fixo, com GRIS / ad valorem / pedágio)
CREATE TABLE IF NOT EXISTS public."tmsFreightTables" (
  table_id         SERIAL PRIMARY KEY,
  name             VARCHAR(120) NOT NULL,
  customer_id      INTEGER,
  customer_name    VARCHAR(200),
  calc_mode        VARCHAR(20) NOT NULL DEFAULT 'PESO'
                   CONSTRAINT "tmsFreightTables_calc_mode_check" CHECK (calc_mode IN ('PESO','KM','FIXO')),
  valid_from       DATE,
  valid_until      DATE,
  cubage_factor    NUMERIC(8,2) NOT NULL DEFAULT 300,
  ad_valorem_pct   NUMERIC(6,3) NOT NULL DEFAULT 0,
  gris_pct         NUMERIC(6,3) NOT NULL DEFAULT 0,
  gris_min         NUMERIC(12,2) NOT NULL DEFAULT 0,
  toll_per_100kg   NUMERIC(12,2) NOT NULL DEFAULT 0,
  pickup_fee       NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_fee     NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_freight      NUMERIC(12,2) NOT NULL DEFAULT 0,
  icms_rate        NUMERIC(6,2) NOT NULL DEFAULT 0,
  icms_included    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."tmsFreightTableRanges" (
  range_id         BIGSERIAL PRIMARY KEY,
  table_id         INTEGER NOT NULL REFERENCES public."tmsFreightTables"(table_id) ON DELETE CASCADE,
  origin_state     VARCHAR(2),
  origin_city      VARCHAR(120),
  destination_state VARCHAR(2),
  destination_city VARCHAR(120),
  weight_from      NUMERIC(12,3) NOT NULL DEFAULT 0,
  weight_to        NUMERIC(12,3),
  price_per_kg     NUMERIC(12,4) NOT NULL DEFAULT 0,
  fixed_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_per_km     NUMERIC(12,4) NOT NULL DEFAULT 0,
  lead_time_days   INTEGER
);
CREATE INDEX IF NOT EXISTS "tmsFreightTableRanges_table_idx" ON public."tmsFreightTableRanges" (table_id);

-- Cotações de frete
CREATE TABLE IF NOT EXISTS public."tmsFreightQuotes" (
  quote_id         BIGSERIAL PRIMARY KEY,
  quote_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until      DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'ABERTA'
                   CONSTRAINT "tmsFreightQuotes_status_check" CHECK (status IN ('ABERTA','APROVADA','RECUSADA','VENCIDA','CONVERTIDA')),
  customer_id      INTEGER,
  customer_name    VARCHAR(200) NOT NULL,
  contact_name     VARCHAR(120),
  contact_phone    VARCHAR(40),
  contact_email    VARCHAR(150),
  origin_city      VARCHAR(120),
  origin_state     VARCHAR(2),
  destination_city VARCHAR(120),
  destination_state VARCHAR(2),
  cargo_description VARCHAR(120),
  weight_kg        NUMERIC(12,3),
  volumes          INTEGER,
  cubage_m3        NUMERIC(12,3),
  cargo_value      NUMERIC(14,2),
  distance_km      NUMERIC(10,1),
  table_id         INTEGER REFERENCES public."tmsFreightTables"(table_id) ON DELETE SET NULL,
  taxable_weight   NUMERIC(12,3),
  freight_weight   NUMERIC(14,2) NOT NULL DEFAULT 0,
  ad_valorem       NUMERIC(14,2) NOT NULL DEFAULT 0,
  gris             NUMERIC(14,2) NOT NULL DEFAULT 0,
  toll             NUMERIC(14,2) NOT NULL DEFAULT 0,
  fees             NUMERIC(14,2) NOT NULL DEFAULT 0,
  icms_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  lead_time_days   INTEGER,
  cte_id           BIGINT REFERENCES public."tmsCte"(cte_id) ON DELETE SET NULL,
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsFreightQuotes_date_idx" ON public."tmsFreightQuotes" (quote_date DESC);

-- Ordens de coleta
CREATE TABLE IF NOT EXISTS public."tmsPickupOrders" (
  pickup_id        BIGSERIAL PRIMARY KEY,
  request_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  scheduled_date   DATE,
  time_window      VARCHAR(30),
  status           VARCHAR(20) NOT NULL DEFAULT 'SOLICITADA'
                   CONSTRAINT "tmsPickupOrders_status_check" CHECK (status IN ('SOLICITADA','AGENDADA','EM_COLETA','COLETADA','CANCELADA')),
  customer_id      INTEGER,
  customer_name    VARCHAR(200) NOT NULL,
  contact_name     VARCHAR(120),
  contact_phone    VARCHAR(40),
  address          VARCHAR(300),
  neighborhood     VARCHAR(120),
  city             VARCHAR(120),
  state            VARCHAR(2),
  postal_code      VARCHAR(12),
  destination_city VARCHAR(120),
  destination_state VARCHAR(2),
  volumes          INTEGER,
  weight_kg        NUMERIC(12,3),
  cubage_m3        NUMERIC(12,3),
  cargo_value      NUMERIC(14,2),
  invoice_numbers  VARCHAR(200),
  quote_id         BIGINT REFERENCES public."tmsFreightQuotes"(quote_id) ON DELETE SET NULL,
  vehicle_id       INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  driver_id        INTEGER REFERENCES public."drivers"(driver_id) ON DELETE SET NULL,
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  collected_at     TIMESTAMPTZ,
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsPickupOrders_date_idx" ON public."tmsPickupOrders" (scheduled_date DESC NULLS LAST, request_date DESC);

-- Faturas de frete (agrupa CT-es do mesmo tomador)
CREATE TABLE IF NOT EXISTS public."tmsFreightInvoices" (
  freight_invoice_id BIGSERIAL PRIMARY KEY,
  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'ABERTA'
                   CONSTRAINT "tmsFreightInvoices_status_check" CHECK (status IN ('ABERTA','EMITIDA','PAGA','CANCELADA')),
  customer_id      INTEGER,
  customer_name    VARCHAR(200) NOT NULL,
  customer_tax_id  VARCHAR(20),
  payment_method   VARCHAR(20) NOT NULL DEFAULT 'BOLETO'
                   CONSTRAINT "tmsFreightInvoices_payment_check" CHECK (payment_method IN ('BOLETO','PIX','TRANSFERENCIA','DINHEIRO','OUTROS')),
  cte_count        INTEGER NOT NULL DEFAULT 0,
  gross_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest         NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount      NUMERIC(14,2),
  paid_at          DATE,
  boleto_number    VARCHAR(60),
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."tmsFreightInvoiceItems" (
  item_id          BIGSERIAL PRIMARY KEY,
  freight_invoice_id BIGINT NOT NULL REFERENCES public."tmsFreightInvoices"(freight_invoice_id) ON DELETE CASCADE,
  cte_id           BIGINT NOT NULL REFERENCES public."tmsCte"(cte_id) ON DELETE RESTRICT,
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT "tmsFreightInvoiceItems_uq" UNIQUE (freight_invoice_id, cte_id)
);
CREATE INDEX IF NOT EXISTS "tmsFreightInvoiceItems_cte_idx" ON public."tmsFreightInvoiceItems" (cte_id);

-- Arquivos EDI (NOTFIS / OCOREN / CONEMB / DOCCOB · layout PROCEDA 3.1)
CREATE TABLE IF NOT EXISTS public."tmsEdiFiles" (
  file_id          BIGSERIAL PRIMARY KEY,
  edi_type         VARCHAR(10) NOT NULL
                   CONSTRAINT "tmsEdiFiles_type_check" CHECK (edi_type IN ('NOTFIS','OCOREN','CONEMB','DOCCOB')),
  direction        VARCHAR(12) NOT NULL DEFAULT 'EXPORTACAO'
                   CONSTRAINT "tmsEdiFiles_direction_check" CHECK (direction IN ('IMPORTACAO','EXPORTACAO')),
  customer_id      INTEGER,
  customer_name    VARCHAR(200),
  file_name        VARCHAR(120) NOT NULL,
  content          TEXT NOT NULL,
  records          INTEGER NOT NULL DEFAULT 0,
  period_from      DATE,
  period_to        DATE,
  status           VARCHAR(12) NOT NULL DEFAULT 'GERADO'
                   CONSTRAINT "tmsEdiFiles_status_check" CHECK (status IN ('GERADO','IMPORTADO','ERRO')),
  result           TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═════════════════════════ OPERAÇÃO ═════════════════════════

-- Planejamento de carga (quais CT-es / coletas vão em qual veículo)
CREATE TABLE IF NOT EXISTS public."tmsLoadPlans" (
  load_plan_id     BIGSERIAL PRIMARY KEY,
  plan_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  name             VARCHAR(120),
  status           VARCHAR(20) NOT NULL DEFAULT 'PLANEJADO'
                   CONSTRAINT "tmsLoadPlans_status_check" CHECK (status IN ('PLANEJADO','CARREGANDO','LIBERADO','CANCELADO')),
  vehicle_id       INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  driver_id        INTEGER REFERENCES public."drivers"(driver_id) ON DELETE SET NULL,
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  total_weight_kg  NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_cubage_m3  NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  item_count       INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."tmsLoadPlanItems" (
  item_id          BIGSERIAL PRIMARY KEY,
  load_plan_id     BIGINT NOT NULL REFERENCES public."tmsLoadPlans"(load_plan_id) ON DELETE CASCADE,
  item_type        VARCHAR(10) NOT NULL DEFAULT 'CTE'
                   CONSTRAINT "tmsLoadPlanItems_type_check" CHECK (item_type IN ('CTE','COLETA','AVULSO')),
  cte_id           BIGINT REFERENCES public."tmsCte"(cte_id) ON DELETE SET NULL,
  pickup_id        BIGINT REFERENCES public."tmsPickupOrders"(pickup_id) ON DELETE SET NULL,
  sequence         INTEGER NOT NULL DEFAULT 1,
  description      VARCHAR(200),
  weight_kg        NUMERIC(12,3),
  cubage_m3        NUMERIC(12,3),
  value            NUMERIC(14,2)
);
CREATE INDEX IF NOT EXISTS "tmsLoadPlanItems_plan_idx" ON public."tmsLoadPlanItems" (load_plan_id, sequence);

-- Contratos de frete com autônomos (TAC) · CIOT e vale-pedágio
CREATE TABLE IF NOT EXISTS public."tmsDriverContracts" (
  contract_id      BIGSERIAL PRIMARY KEY,
  contract_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'ABERTO'
                   CONSTRAINT "tmsDriverContracts_status_check" CHECK (status IN ('ABERTO','CIOT_GERADO','QUITADO','CANCELADO')),
  contractor_name  VARCHAR(200) NOT NULL,
  contractor_doc   VARCHAR(20) NOT NULL,
  contractor_rntrc VARCHAR(20),
  contractor_pis   VARCHAR(20),
  contractor_dependents INTEGER NOT NULL DEFAULT 0,
  transporter_id   INTEGER,
  vehicle_plate    VARCHAR(10),
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  mdfe_id          BIGINT REFERENCES public."tmsMdfe"(mdfe_id) ON DELETE SET NULL,
  origin_city      VARCHAR(120),
  origin_state     VARCHAR(2),
  destination_city VARCHAR(120),
  destination_state VARCHAR(2),
  freight_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  advance_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  toll_voucher_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  toll_voucher_supplier VARCHAR(60),
  toll_voucher_number VARCHAR(30),
  ciot_number      VARCHAR(20),
  ciot_provider    VARCHAR(60),
  inss_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sest_senat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  irrf_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_at          DATE,
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsDriverContracts_trip_idx" ON public."tmsDriverContracts" (trip_id) WHERE trip_id IS NOT NULL;

-- Jornada do motorista (Lei 13.103/2015)
CREATE TABLE IF NOT EXISTS public."tmsDriverJourneys" (
  journey_id       BIGSERIAL PRIMARY KEY,
  driver_id        INTEGER NOT NULL REFERENCES public."drivers"(driver_id) ON DELETE RESTRICT,
  vehicle_id       INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  journey_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  start_at         TIMESTAMPTZ NOT NULL,
  end_at           TIMESTAMPTZ,
  meal_break_min   INTEGER NOT NULL DEFAULT 0,
  rest_break_min   INTEGER NOT NULL DEFAULT 0,
  waiting_min      INTEGER NOT NULL DEFAULT 0,
  driving_min      INTEGER,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsDriverJourneys_driver_idx" ON public."tmsDriverJourneys" (driver_id, start_at DESC);

-- Despesas da viagem (pedágio, diárias...) para o resultado por viagem
CREATE TABLE IF NOT EXISTS public."tmsTripExpenses" (
  expense_id       BIGSERIAL PRIMARY KEY,
  trip_id          BIGINT NOT NULL REFERENCES public."deliveryTrips"(trip_id) ON DELETE CASCADE,
  expense_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  expense_type     VARCHAR(20) NOT NULL DEFAULT 'PEDAGIO'
                   CONSTRAINT "tmsTripExpenses_type_check" CHECK (expense_type IN ('PEDAGIO','DIARIA','ALIMENTACAO','HOSPEDAGEM','CARGA_DESCARGA','ESTACIONAMENTO','COMISSAO','OUTROS')),
  description      VARCHAR(200),
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsTripExpenses_trip_idx" ON public."tmsTripExpenses" (trip_id);

-- ═════════════════════════ FROTA ═════════════════════════

-- Planos de manutenção preventiva (a cada X km / Y dias)
CREATE TABLE IF NOT EXISTS public."tmsMaintenancePlans" (
  maintenance_plan_id SERIAL PRIMARY KEY,
  vehicle_id       INTEGER NOT NULL REFERENCES public."vehicles"(vehicle_id) ON DELETE CASCADE,
  service_name     VARCHAR(120) NOT NULL,
  interval_km      INTEGER,
  interval_days    INTEGER,
  last_km          INTEGER,
  last_date        DATE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordens de serviço (OS) de manutenção
CREATE TABLE IF NOT EXISTS public."tmsWorkOrders" (
  work_order_id    BIGSERIAL PRIMARY KEY,
  vehicle_id       INTEGER NOT NULL REFERENCES public."vehicles"(vehicle_id) ON DELETE RESTRICT,
  maintenance_plan_id INTEGER REFERENCES public."tmsMaintenancePlans"(maintenance_plan_id) ON DELETE SET NULL,
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  wo_type          VARCHAR(20) NOT NULL DEFAULT 'PREVENTIVA'
                   CONSTRAINT "tmsWorkOrders_type_check" CHECK (wo_type IN ('PREVENTIVA','CORRETIVA','PREDITIVA','SOCORRO')),
  status           VARCHAR(20) NOT NULL DEFAULT 'ABERTA'
                   CONSTRAINT "tmsWorkOrders_status_check" CHECK (status IN ('ABERTA','EM_EXECUCAO','CONCLUIDA','CANCELADA')),
  open_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  close_date       DATE,
  odometer_km      INTEGER,
  workshop_name    VARCHAR(150),
  description      TEXT NOT NULL,
  parts_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  labor_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_number   VARCHAR(30),
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsWorkOrders_vehicle_idx" ON public."tmsWorkOrders" (vehicle_id, open_date DESC);

-- Pneus (nº de fogo) e movimentações
CREATE TABLE IF NOT EXISTS public."tmsTires" (
  tire_id          SERIAL PRIMARY KEY,
  fire_number      VARCHAR(30) NOT NULL,
  brand            VARCHAR(60),
  model            VARCHAR(60),
  size             VARCHAR(30),
  status           VARCHAR(20) NOT NULL DEFAULT 'ESTOQUE'
                   CONSTRAINT "tmsTires_status_check" CHECK (status IN ('ESTOQUE','EM_USO','RECAPAGEM','SUCATA')),
  vehicle_id       INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  position         VARCHAR(10),
  installed_km     INTEGER,
  total_km         INTEGER NOT NULL DEFAULT 0,
  retread_count    INTEGER NOT NULL DEFAULT 0,
  tread_depth_mm   NUMERIC(5,2),
  purchase_date    DATE,
  purchase_cost    NUMERIC(12,2),
  supplier_name    VARCHAR(150),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tmsTires_fire_number_uq" ON public."tmsTires" (UPPER(fire_number));

CREATE TABLE IF NOT EXISTS public."tmsTireMovements" (
  tire_movement_id BIGSERIAL PRIMARY KEY,
  tire_id          INTEGER NOT NULL REFERENCES public."tmsTires"(tire_id) ON DELETE CASCADE,
  movement_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  movement_type    VARCHAR(20) NOT NULL
                   CONSTRAINT "tmsTireMovements_type_check" CHECK (movement_type IN ('MONTAGEM','DESMONTAGEM','RODIZIO','RECAPAGEM','RETORNO_RECAPAGEM','INSPECAO','SUCATA')),
  vehicle_id       INTEGER REFERENCES public."vehicles"(vehicle_id) ON DELETE SET NULL,
  position         VARCHAR(10),
  odometer_km      INTEGER,
  tread_depth_mm   NUMERIC(5,2),
  cost             NUMERIC(12,2),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsTireMovements_tire_idx" ON public."tmsTireMovements" (tire_id, movement_date DESC);

-- Abastecimentos
CREATE TABLE IF NOT EXISTS public."tmsFuelEntries" (
  fuel_entry_id    BIGSERIAL PRIMARY KEY,
  vehicle_id       INTEGER NOT NULL REFERENCES public."vehicles"(vehicle_id) ON DELETE RESTRICT,
  driver_id        INTEGER REFERENCES public."drivers"(driver_id) ON DELETE SET NULL,
  trip_id          BIGINT REFERENCES public."deliveryTrips"(trip_id) ON DELETE SET NULL,
  fuel_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  odometer_km      INTEGER,
  fuel_type        VARCHAR(20) NOT NULL DEFAULT 'DIESEL_S10'
                   CONSTRAINT "tmsFuelEntries_type_check" CHECK (fuel_type IN ('DIESEL_S10','DIESEL_S500','ARLA32','GASOLINA','ETANOL','GNV')),
  liters           NUMERIC(10,3) NOT NULL,
  unit_price       NUMERIC(10,4),
  total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  full_tank        BOOLEAN NOT NULL DEFAULT TRUE,
  station_name     VARCHAR(150),
  invoice_number   VARCHAR(30),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsFuelEntries_vehicle_idx" ON public."tmsFuelEntries" (vehicle_id, fuel_date DESC, odometer_km DESC);

-- Documentos do veículo (CRLV, licenciamento, IPVA, seguro, tacógrafo, AET...)
CREATE TABLE IF NOT EXISTS public."tmsVehicleDocuments" (
  vehicle_document_id SERIAL PRIMARY KEY,
  vehicle_id       INTEGER NOT NULL REFERENCES public."vehicles"(vehicle_id) ON DELETE CASCADE,
  doc_type         VARCHAR(20) NOT NULL DEFAULT 'CRLV'
                   CONSTRAINT "tmsVehicleDocuments_type_check" CHECK (doc_type IN ('CRLV','LICENCIAMENTO','IPVA','SEGURO','TACOGRAFO','AET','ANTT','CIV_CIPP','OUTROS')),
  doc_number       VARCHAR(40),
  issue_date       DATE,
  expiration_date  DATE,
  amount           NUMERIC(12,2),
  is_paid          BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at          DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tmsVehicleDocuments_exp_idx" ON public."tmsVehicleDocuments" (expiration_date);

-- Multas de trânsito
CREATE TABLE IF NOT EXISTS public."tmsTrafficFines" (
  fine_id          SERIAL PRIMARY KEY,
  vehicle_id       INTEGER NOT NULL REFERENCES public."vehicles"(vehicle_id) ON DELETE RESTRICT,
  driver_id        INTEGER REFERENCES public."drivers"(driver_id) ON DELETE SET NULL,
  ait_number       VARCHAR(30),
  infraction_date  TIMESTAMPTZ,
  infraction_code  VARCHAR(10),
  description      VARCHAR(250),
  location         VARCHAR(200),
  agency           VARCHAR(80),
  points           INTEGER,
  amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_date         DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'RECEBIDA'
                   CONSTRAINT "tmsTrafficFines_status_check" CHECK (status IN ('RECEBIDA','CONDUTOR_INDICADO','RECURSO','PAGA','CANCELADA')),
  charge_driver    BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at          DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═════════════════════════ TRIGGERS updated_at ═════════════════════════
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tmsInsurancePolicies','tmsCte','tmsCteEvents','tmsMdfe','tmsFreightTables','tmsFreightQuotes',
    'tmsPickupOrders','tmsFreightInvoices','tmsEdiFiles','tmsLoadPlans','tmsDriverContracts',
    'tmsDriverJourneys','tmsTripExpenses','tmsMaintenancePlans','tmsWorkOrders','tmsTires',
    'tmsTireMovements','tmsFuelEntries','tmsVehicleDocuments','tmsTrafficFines'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_tms_set_updated_at()',
        'trg_' || t || '_updated_at', t
      );
    END IF;
  END LOOP;
END $$;
`;
