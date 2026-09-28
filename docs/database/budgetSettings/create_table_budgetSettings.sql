-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ create_table_budgetSettings.sql — Parâmetros globais dos Orçamentos  ║
-- ║ CONSART ERP | PostgreSQL                                             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Tabela singleton: sempre existe no máximo uma linha (setting_id = 1).
-- Script idempotente: pode ser executado mais de uma vez.

BEGIN;


CREATE TABLE IF NOT EXISTS public."budgetSettings" (
  setting_id              smallint                 NOT NULL DEFAULT 1,
  allow_out_of_stock      boolean                  NOT NULL DEFAULT false,
  require_stock_lot       boolean                  NOT NULL DEFAULT false,
  allow_manual_unit_price boolean                  NOT NULL DEFAULT true,
  max_discount_percent    numeric(5,2)             NOT NULL DEFAULT 100,
  updated_at              timestamp with time zone NOT NULL DEFAULT now(),
  updated_by              character varying(100),
  out_of_stock_mode       character varying(20)    NOT NULL DEFAULT 'BLOCK'::character varying,

  CONSTRAINT "budgetSettings_pkey"
    PRIMARY KEY (setting_id),

  CONSTRAINT "budgetSettings_max_discount_percent_check"
    CHECK (max_discount_percent >= 0::numeric AND max_discount_percent <= 100::numeric),

  CONSTRAINT "budgetSettings_setting_id_check"
    CHECK (setting_id = 1),

  CONSTRAINT budget_settings_out_of_stock_mode_check
    CHECK (out_of_stock_mode::text = ANY (ARRAY[
      'BLOCK'::character varying,
      'PASSWORD'::character varying,
      'ALLOW'::character varying
    ]::text[]))
);

COMMENT ON TABLE  public."budgetSettings"                         IS 'Parâmetros globais dos Orçamentos (linha única, setting_id = 1).';

COMMENT ON COLUMN public."budgetSettings".setting_id              IS 'Identificador fixo da linha de configuração (sempre 1).';

COMMENT ON COLUMN public."budgetSettings".allow_out_of_stock      IS 'Legado: TRUE quando out_of_stock_mode <> BLOCK.';

COMMENT ON COLUMN public."budgetSettings".require_stock_lot       IS 'Exige informar o lote de estoque nos itens do orçamento.';

COMMENT ON COLUMN public."budgetSettings".allow_manual_unit_price IS 'Permite alterar manualmente o preço unitário.';

COMMENT ON COLUMN public."budgetSettings".max_discount_percent    IS 'Desconto máximo permitido, de 0 a 100%.';

COMMENT ON COLUMN public."budgetSettings".updated_at              IS 'Data/hora da última alteração.';

COMMENT ON COLUMN public."budgetSettings".updated_by              IS 'Usuário responsável pela última alteração.';

COMMENT ON COLUMN public."budgetSettings".out_of_stock_mode       IS 'Venda sem estoque: BLOCK (bloqueia), PASSWORD (exige senha), ALLOW (permite).';

-- Linha padrão (não sobrescreve configuração existente).
INSERT INTO public."budgetSettings" (
  setting_id,
  out_of_stock_mode,
  allow_out_of_stock,
  require_stock_lot,
  allow_manual_unit_price,
  max_discount_percent
)
VALUES (1, 'BLOCK', FALSE, FALSE, TRUE, 100)
ON CONFLICT (setting_id) DO NOTHING;

COMMIT;