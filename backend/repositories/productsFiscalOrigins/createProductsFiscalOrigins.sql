-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ createProductsFiscalOrigins.sql — CONSART ERP                          ║
-- ║ Tabela: public."productsFiscalOrigins"                                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- PROPÓSITO
-- ---------
-- Guardar, por produto (e opcionalmente por lote/grade), os valores fiscais
-- necessários para emitir NF-e — principalmente a origem do ICMS-ST retido
-- anteriormente exigida pelo CST 60 — SEM depender de uma NF-e de entrada
-- em "inboundInvoiceItems".
--
-- Preenchida pelo botão "Atualizar dados fiscais" do modal de lote, que
-- calcula exclusivamente a partir de:
--
--   "productsFiscalV2" -> "fiscalClassificationV2" -> "fiscalProfileV2"
--
-- PRECEDÊNCIA NA EMISSÃO
-- ----------------------
-- A NF-e de entrada real continua tendo prioridade. Esta tabela só é usada
-- quando "inboundInvoiceItems" não fornece uma origem ST completa.
--
-- GRÃO (atende os dois modos de estoque do ERP)
-- ---------------------------------------------
--   lot_id preenchido -> origem específica daquele lote  (STOCK_WITH_LOT)
--   lot_id NULL       -> origem padrão do produto        (STOCK_SIMPLE)
--
-- product_grade_id segue a mesma lógica: NULL vale para qualquer grade.
--
-- CONVENÇÃO DE QUANTIDADE
-- -----------------------
-- As linhas são gravadas POR UNIDADE (quantity = 1, conversion_factor = 1),
-- com os totais iguais aos valores unitários. A proporção para a quantidade
-- vendida é aplicada na emissão, por calculateRetainedIcmsSt().
--
-- Script idempotente: pode ser executado mais de uma vez com segurança.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1. Tabela
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."productsFiscalOrigins" (
  fiscal_origin_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Escopo
  product_code             VARCHAR(60)   NOT NULL,
  product_id               INTEGER,
  product_grade_id         INTEGER,
  lot_id                   INTEGER,

  -- Quantidade de referência a que os totais se referem
  unit                     VARCHAR(10),
  quantity                 NUMERIC(18,6) NOT NULL DEFAULT 1,
  conversion_factor        NUMERIC(18,6) NOT NULL DEFAULT 1,
  unit_cost                NUMERIC(18,6),

  -- ICMS próprio
  icms_cst                 VARCHAR(3),
  icms_base                NUMERIC(18,6),
  icms_rate                NUMERIC(9,4),
  icms_value               NUMERIC(18,6),

  -- ICMS-ST
  icms_st_mva_rate         NUMERIC(9,4),
  icms_st_base             NUMERIC(18,6),
  icms_st_rate             NUMERIC(9,4),
  icms_st_value            NUMERIC(18,6),

  -- FCP-ST
  fcp_st_base              NUMERIC(18,6),
  fcp_st_rate              NUMERIC(9,4),
  fcp_st_value             NUMERIC(18,6),

  -- Demais tributos da regra
  ipi_rate                 NUMERIC(9,4),
  pis_rate                 NUMERIC(9,4),
  cofins_rate              NUMERIC(9,4),

  -- Proveniência do cálculo
  source                   VARCHAR(40)   NOT NULL DEFAULT 'PRODUCT_FISCAL_RULE',
  rule_id                  BIGINT,
  rule_source              VARCHAR(40),
  calculation_mode         VARCHAR(30),
  products_fiscal_id       BIGINT,
  fiscal_classification_id INTEGER,
  fiscal_profile_id        INTEGER,

  -- Payload completo do cálculo, para auditoria
  raw_tax_payload          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  notes                    TEXT,
  is_active                BOOLEAN       NOT NULL DEFAULT TRUE,

  calculated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  user_id                  BIGINT,

  CONSTRAINT ck_productsfiscalorigins_quantity
    CHECK (quantity > 0 AND conversion_factor > 0)
);


-- ────────────────────────────────────────────────────────────────────────
-- 2. Índices
--
-- O índice único é PARCIAL e usa COALESCE porque o PostgreSQL não considera
-- dois NULLs iguais entre si: sem isso seria possível gravar várias origens
-- padrão (lot_id NULL) para o mesmo produto.
--
-- É exatamente este índice que o ON CONFLICT do upsert infere.
-- ────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS productsfiscalorigins_scope_ux
  ON public."productsFiscalOrigins" (
    product_code,
    COALESCE(lot_id, 0),
    COALESCE(product_grade_id, 0)
  )
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_productsfiscalorigins_product
  ON public."productsFiscalOrigins" (product_code)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_productsfiscalorigins_lot
  ON public."productsFiscalOrigins" (lot_id)
  WHERE is_active = TRUE AND lot_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────
-- 3. Trigger de updated_at
--
-- A API já grava updated_at explicitamente no upsert; o trigger protege
-- alterações manuais feitas direto no banco.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.productsfiscalorigins_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_productsfiscalorigins_set_updated_at
  ON public."productsFiscalOrigins";

CREATE TRIGGER trg_productsfiscalorigins_set_updated_at
  BEFORE UPDATE ON public."productsFiscalOrigins"
  FOR EACH ROW
  EXECUTE FUNCTION public.productsfiscalorigins_set_updated_at();


-- ────────────────────────────────────────────────────────────────────────
-- 4. Comentários
-- ────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public."productsFiscalOrigins" IS
  'Origem fiscal do produto calculada pela regra fiscal (productsFiscalV2), '
  'usada para emitir NF-e sem depender de NF-e de entrada.';

COMMENT ON COLUMN public."productsFiscalOrigins".lot_id IS
  'Lote da origem. NULL = origem padrão do produto (modo de estoque simples).';

COMMENT ON COLUMN public."productsFiscalOrigins".product_grade_id IS
  'Grade da origem. NULL = vale para qualquer grade.';

COMMENT ON COLUMN public."productsFiscalOrigins".quantity IS
  'Quantidade a que os totais se referem. A API grava sempre 1 (valores por unidade).';

COMMENT ON COLUMN public."productsFiscalOrigins".raw_tax_payload IS
  'Payload completo do cálculo da regra fiscal, para auditoria.';

COMMIT;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ 5. FK para products                                                    ║
-- ║                                                                        ║
-- ║ Válida porque public.products.product_code possui índice único         ║
-- ║ (products_product_code_key), o mesmo pressuposto de                    ║
-- ║ "productFiscalCostRules".                                              ║
-- ║                                                                        ║
-- ║ Fora da transação acima e envolvida em DO/EXCEPTION para que o script  ║
-- ║ permaneça idempotente e a criação da tabela não seja desfeita caso a   ║
-- ║ constraint já exista.                                                  ║
-- ╚════════════════════════════════════════════════════════════════════════╝
DO $$
BEGIN
  ALTER TABLE public."productsFiscalOrigins"
    ADD CONSTRAINT "productsFiscalOrigins_product_fk"
    FOREIGN KEY (product_code)
    REFERENCES public.products (product_code)
    ON UPDATE CASCADE
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Constraint productsFiscalOrigins_product_fk já existe.';
END;
$$;
