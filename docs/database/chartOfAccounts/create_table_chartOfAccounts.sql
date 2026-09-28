-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ create_table_chartOfAccounts.sql — DDL da tabela public."chartOfAccounts"║
-- ║ CONSART ERP — Documentação                                               ║
-- ║ Espelha: catalog_schema.chartOfAccounts.js                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Observações:
--   • O nome da tabela diferencia maiúsculas/minúsculas: use sempre
--     aspas duplas ("chartOfAccounts").
--   • Plano de contas hierárquico: parent_account_id aponta para a conta pai
--     na própria tabela. Ao excluir a conta pai, os filhos ficam sem pai
--     (ON DELETE SET NULL).
--   • account_type: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE.
--   • nature: DEBIT, CREDIT.
--   • level >= 1 (a API infere o nível pela quantidade de segmentos do
--     código, ex.: "1.1.1" → 3).
--   • updated_at é atualizado automaticamente pelo trigger
--     trg_chartofaccounts_updated_at.
--   • O índice idx_chartofaccounts_code é redundante com a constraint
--     UNIQUE chartOfAccounts_code_key (ambos indexam code); mantido aqui
--     porque existe no banco.
--   • O script pode ser executado mais de uma vez sem erro.

/* ───────────────────────────── Sequence ───────────────────────────── */

CREATE SEQUENCE IF NOT EXISTS public."chartOfAccounts_id_seq" AS integer;

/* ────────────────────────────── Tabela ────────────────────────────── */


CREATE TABLE IF NOT EXISTS public."chartOfAccounts" (
    id                integer                     NOT NULL DEFAULT nextval('"chartOfAccounts_id_seq"'::regclass),
    code              character varying(30)       NOT NULL,
    description       character varying(200)      NOT NULL,
    account_type      character varying(20)       NOT NULL,
    nature            character varying(10)       NOT NULL,
    level             integer                     NOT NULL DEFAULT 1,
    parent_account_id integer,
    allows_posting    boolean                     NOT NULL DEFAULT true,
    is_active         boolean                     NOT NULL DEFAULT true,
    notes             text,
    created_at        timestamp without time zone NOT NULL DEFAULT now(),
    updated_at        timestamp without time zone NOT NULL DEFAULT now(),

    CONSTRAINT "chartOfAccounts_pkey"     PRIMARY KEY (id),
    CONSTRAINT "chartOfAccounts_code_key" UNIQUE (code),

    CONSTRAINT chk_chartofaccounts_level
        CHECK (level >= 1),
    CONSTRAINT chk_chartofaccounts_nature
        CHECK (nature IN ('DEBIT', 'CREDIT')),
    CONSTRAINT chk_chartofaccounts_type
        CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),

    CONSTRAINT fk_chartofaccounts_parent
        FOREIGN KEY (parent_account_id)
        REFERENCES public."chartOfAccounts" (id)
        ON DELETE SET NULL
);

-- A sequence pertence à coluna id (mesmo comportamento de SERIAL)
ALTER SEQUENCE public."chartOfAccounts_id_seq" OWNED BY public."chartOfAccounts".id;

/* ────────────────────────────── Índices ───────────────────────────── */

CREATE INDEX IF NOT EXISTS idx_chartofaccounts_active
    ON public."chartOfAccounts" USING btree (is_active);

CREATE INDEX IF NOT EXISTS idx_chartofaccounts_code
    ON public."chartOfAccounts" USING btree (code);

CREATE INDEX IF NOT EXISTS idx_chartofaccounts_description
    ON public."chartOfAccounts" USING btree (description);

CREATE INDEX IF NOT EXISTS idx_chartofaccounts_parent
    ON public."chartOfAccounts" USING btree (parent_account_id);

CREATE INDEX IF NOT EXISTS idx_chartofaccounts_type
    ON public."chartOfAccounts" USING btree (account_type);

/* ───────────────────────── Trigger updated_at ─────────────────────── */

CREATE OR REPLACE FUNCTION public.set_chartofaccounts_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cria o trigger apenas se ainda não existir
DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_chartofaccounts_updated_at'
          AND tgrelid = 'public."chartOfAccounts"'::regclass
    ) THEN
        CREATE TRIGGER trg_chartofaccounts_updated_at
            BEFORE UPDATE ON public."chartOfAccounts"
            FOR EACH ROW
            EXECUTE FUNCTION public.set_chartofaccounts_updated_at();
    END IF;
END
$do$;

/* ──────────────────────────── Comentários ─────────────────────────── */

COMMENT ON TABLE  public."chartOfAccounts"                   IS 'Plano de contas contábil (estrutura hierárquica).';

COMMENT ON COLUMN public."chartOfAccounts".id                IS 'Identificador da conta.';

COMMENT ON COLUMN public."chartOfAccounts".code              IS 'Código da conta, único (ex.: 1.1.01).';

COMMENT ON COLUMN public."chartOfAccounts".description       IS 'Descrição da conta.';

COMMENT ON COLUMN public."chartOfAccounts".account_type      IS 'Tipo: ASSET, LIABILITY, EQUITY, REVENUE ou EXPENSE.';

COMMENT ON COLUMN public."chartOfAccounts".nature            IS 'Natureza: DEBIT ou CREDIT.';

COMMENT ON COLUMN public."chartOfAccounts".level             IS 'Nível na hierarquia (>= 1).';

COMMENT ON COLUMN public."chartOfAccounts".parent_account_id IS 'Conta pai (NULL para contas raiz).';

COMMENT ON COLUMN public."chartOfAccounts".allows_posting    IS 'Indica se a conta aceita lançamentos (conta analítica).';

COMMENT ON COLUMN public."chartOfAccounts".is_active         IS 'Indica se a conta está ativa.';

COMMENT ON COLUMN public."chartOfAccounts".notes             IS 'Observações livres.';

COMMENT ON COLUMN public."chartOfAccounts".created_at        IS 'Data/hora de criação do registro.';

COMMENT ON COLUMN public."chartOfAccounts".updated_at        IS 'Data/hora da última alteração (mantida pelo trigger).';

/* ─────────────── Tabelas que referenciam chartOfAccounts ─────────────── */
-- Referência apenas. Estas FKs pertencem às outras tabelas e são criadas
-- nos scripts delas; não execute este bloco junto com a criação de chartOfAccounts.
-- (A auto-referência fk_chartofaccounts_parent já está na tabela acima.)
--
-- ALTER TABLE public."accountsReceivable"
--     ADD CONSTRAINT accounts_receivable_chart_account_fk
--     FOREIGN KEY (chart_account_id) REFERENCES public."chartOfAccounts" (id)
--     ON UPDATE CASCADE ON DELETE SET NULL;
--
-- ALTER TABLE public."cashMoviments"
--     ADD CONSTRAINT fk_cashmoviments_chart_account
--     FOREIGN KEY (chart_account_id) REFERENCES public."chartOfAccounts" (id)
--     ON DELETE SET NULL;
--
-- ALTER TABLE public.suppliers
--     ADD CONSTRAINT fk_suppliers_chart_account
--     FOREIGN KEY (chart_account_id) REFERENCES public."chartOfAccounts" (id)
--     ON UPDATE CASCADE ON DELETE SET NULL;