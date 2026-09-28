-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ create_table_nfeStatusMap.sql                                      ║
-- ║ Mapa central de status NF-e | CONSART ERP                          ║
-- ║ Tabela: public."nfeStatusMap"                                      ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- =====================================================================
-- Table
-- =====================================================================

CREATE TABLE public."nfeStatusMap" (

---------------------------------------------------------------------
-- Identification
---------------------------------------------------------------------

nfe_status_id INTEGER GENERATED ALWAYS AS IDENTITY,

---------------------------------------------------------------------
-- Status
---------------------------------------------------------------------

code VARCHAR(30) NOT NULL,
name VARCHAR(100) NOT NULL,
description TEXT,

---------------------------------------------------------------------
-- Behavior
---------------------------------------------------------------------

is_final BOOLEAN NOT NULL DEFAULT FALSE,
is_authorized BOOLEAN NOT NULL DEFAULT FALSE,
is_active BOOLEAN NOT NULL DEFAULT TRUE,

---------------------------------------------------------------------
-- Audit
---------------------------------------------------------------------

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

---------------------------------------------------------------------
-- Primary Key
---------------------------------------------------------------------

CONSTRAINT "nfeStatusMap_pkey" PRIMARY KEY (nfe_status_id),

---------------------------------------------------------------------
-- Unique Constraints
---------------------------------------------------------------------

CONSTRAINT uq_nfe_status_map_code UNIQUE (code) );

-- =====================================================================
-- Indexes
-- =====================================================================

CREATE INDEX idx_nfe_status_map_active
    ON public."nfeStatusMap" (is_active);

CREATE INDEX idx_nfe_status_map_name
    ON public."nfeStatusMap" (name);

-- =====================================================================
-- Comments
-- =====================================================================

COMMENT ON TABLE public."nfeStatusMap"
IS 'Mapa central de status da NF-e utilizado pelos módulos de emissão e tentativas de autorização.';

COMMENT ON COLUMN public."nfeStatusMap".nfe_status_id
IS 'Identificador interno do status da NF-e.';

COMMENT ON COLUMN public."nfeStatusMap".code
IS 'Código único utilizado internamente pelo ERP.';

COMMENT ON COLUMN public."nfeStatusMap".name
IS 'Nome de exibição do status da NF-e.';

COMMENT ON COLUMN public."nfeStatusMap".description
IS 'Descrição detalhada do status.';

COMMENT ON COLUMN public."nfeStatusMap".is_final
IS 'Indica se o status encerra o processamento da NF-e.';

COMMENT ON COLUMN public."nfeStatusMap".is_authorized
IS 'Indica se o status representa uma NF-e autorizada.';

COMMENT ON COLUMN public."nfeStatusMap".is_active
IS 'Indica se o status está disponível para utilização no ERP.';

COMMENT ON COLUMN public."nfeStatusMap".created_at
IS 'Data e hora de criação do registro.';

COMMENT ON COLUMN public."nfeStatusMap".updated_at
IS 'Data e hora da última atualização do registro.';

COMMIT;