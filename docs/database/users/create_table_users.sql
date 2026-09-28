-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ create_table_users.sql — DDL da tabela public.users                      ║
-- ║ CONSART ERP — Documentação                                               ║
-- ║ Espelha: catalog_schema.users.js                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Observações:
--   • A tabela NÃO possui PRIMARY KEY declarada. A unicidade de user_id é
--     garantida pela constraint UNIQUE "users_id_unique".
--   • A sequence mantém o nome legado "cadastro_usuarios_id_seq".
--   • email é opcional, mas único quando informado (índice "users_email_unique").
--   • password_hash guarda o hash bcrypt gerado pelo usersController;
--     nunca é devolvido pela API.

/* ───────────────────────────── Sequence ───────────────────────────── */

CREATE SEQUENCE IF NOT EXISTS public.cadastro_usuarios_id_seq;

/* ────────────────────────────── Tabela ────────────────────────────── */


CREATE TABLE IF NOT EXISTS public.users (
    user_id       integer                     NOT NULL DEFAULT nextval('cadastro_usuarios_id_seq'::regclass),
    name          character varying(100)      NOT NULL,
    email         character varying(100),
    password_hash character varying(100)      NOT NULL,
    access_level  character varying(50)       NOT NULL,
    created_at    timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active     boolean                     DEFAULT true,

    CONSTRAINT users_id_unique UNIQUE (user_id)
);

/* ────────────────────────────── Índices ───────────────────────────── */

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON public.users USING btree (email);

/* ──────────────────────────── Comentários ─────────────────────────── */

COMMENT ON
TABLE public.users IS 'Usuários do sistema (login e controle de acesso).';

COMMENT ON COLUMN public.users.user_id IS 'Identificador do usuário (sequence cadastro_usuarios_id_seq).';

COMMENT ON COLUMN public.users.name IS 'Nome do usuário.';

COMMENT ON COLUMN public.users.email IS 'E-mail do usuário; único quando informado.';

COMMENT ON COLUMN public.users.password_hash IS 'Hash bcrypt da senha. Nunca devolvido pela API.';

COMMENT ON COLUMN public.users.access_level IS 'Nível de acesso (a API usa ''User'' como padrão).';

COMMENT ON COLUMN public.users.created_at IS 'Data/hora de criação do registro.';

COMMENT ON COLUMN public.users.is_active IS 'Indica se o usuário está ativo.';

/* ─────────────────── Tabelas que referenciam users ─────────────────── */
-- Referência apenas. Estas FKs pertencem às outras tabelas e são criadas
-- nos scripts delas; não execute este bloco junto com a criação de users.
--
-- ALTER TABLE public."productsPrices"
--     ADD CONSTRAINT ".productsPrices_user_id_fkey"
--     FOREIGN KEY (user_id) REFERENCES public.users (user_id)
--     ON UPDATE CASCADE ON DELETE SET NULL;
--
-- ALTER TABLE public."emailSignatures"
--     ADD CONSTRAINT "emailSignatures_owneruserid_fkey"
--     FOREIGN KEY (owneruserid) REFERENCES public.users (user_id)
--     ON DELETE SET NULL;
--
-- ALTER TABLE public."processesUsers"
--     ADD CONSTRAINT fk_processes_users_user
--     FOREIGN KEY (user_id) REFERENCES public.users (user_id)
--     ON UPDATE CASCADE ON DELETE CASCADE;
--
-- ALTER TABLE public."userEmailAccounts"
--     ADD CONSTRAINT fk_useremailaccounts_user
--     FOREIGN KEY (user_id) REFERENCES public.users (user_id)
--     ON DELETE CASCADE;
--
-- ALTER TABLE public.inventories
--     ADD CONSTRAINT inventories_created_by_fkey
--     FOREIGN KEY (created_by) REFERENCES public.users (user_id);
--
-- ALTER TABLE public.inventories
--     ADD CONSTRAINT inventories_finalized_by_fkey
--     FOREIGN KEY (finalized_by) REFERENCES public.users (user_id);
--
-- ALTER TABLE public."sellerByOrders"
--     ADD CONSTRAINT "sellerByOrders_user_id_fkey"
--     FOREIGN KEY (user_id) REFERENCES public.users (user_id)
--     ON DELETE SET NULL;