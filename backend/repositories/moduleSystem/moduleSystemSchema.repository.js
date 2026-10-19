// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemSchema.repository.js — ensureTable (idempotente)       ║
// ║ Tabela: public."moduleSystem"                                      ║
// ║ A tabela também guarda a árvore do menu (menuConsart.js lê via     ║
// ║ GET /api/module-system/menu).                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { TABLE } from './moduleSystem.constants.js';
import { q } from './moduleSystem.utils.js';

/**
 * Garante que a tabela exista e esteja com colunas atualizadas (idempotente).
 * @param {Function} run executor de SQL (padrão: pool). O script de migração
 *                       passa o client da transação para rodar tudo junto.
 */
export async function ensureTable(run = q) {
  await run(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id         BIGSERIAL     PRIMARY KEY,
      name       VARCHAR(100)  NOT NULL,
      path       VARCHAR(200)  NOT NULL,
      is_active  BOOLEAN       NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
    );
  `);

  // Ajustes de compatibilidade (caso venha de versões antigas)
  await run(`
    ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS name       VARCHAR(100),
      ADD COLUMN IF NOT EXISTS path       VARCHAR(200),
      ADD COLUMN IF NOT EXISTS is_active  BOOLEAN       NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ   NOT NULL DEFAULT now();
  `);

  // Colunas do menu
  //  menu_type   'dropdown' | 'submenu' | 'link' | NULL (fora do menu)
  //  parent_id   id do dropdown/submenu pai (NULL = topo do menu)
  //  sort_order  ordem entre os irmãos
  //  html_id     id HTML do dropdown (ex.: 'gestao-erp')
  //  css_class   classe extra do link (ex.: 'link-inicio')
  //  feature     appFeature que controla o item (ex.: 'PRODUCT_LOCATIONS')
  //  is_external abre em nova aba
  //  is_public   visível para todos, sem controle por userModules
  await run(`
    ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS menu_type   VARCHAR(20),
      ADD COLUMN IF NOT EXISTS parent_id   BIGINT,
      ADD COLUMN IF NOT EXISTS sort_order  INTEGER     NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS html_id     VARCHAR(60),
      ADD COLUMN IF NOT EXISTS css_class   VARCHAR(60),
      ADD COLUMN IF NOT EXISTS feature     VARCHAR(60),
      ADD COLUMN IF NOT EXISTS is_external BOOLEAN     NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_public   BOOLEAN     NOT NULL DEFAULT false;
  `);

  // Empresa do item no menu (botão do rodapé troca a empresa ativa)
  //  company  'BH3' | 'CONSART' | NULL (aparece nas duas)
  // Na primeira vez que a coluna é criada, as telas que só existem na
  // Consart ERP já ficam marcadas como CONSART.
  const { rows: companyCol } = await run(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'moduleSystem' AND column_name = 'company';
  `);
  if (!companyCol?.length) {
    await run(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS company VARCHAR(20);`);
    await run(`
      UPDATE ${TABLE}
      SET company = 'CONSART'
      WHERE path ~* '(crmConsartErp|customersListConsart|customersRegistrationConsart|customersEditConsart|customerStatusTypesConsart|customerSegmentsConsart|sellersConsart|proposalsConsart|proposalsServicesConsart|servicesConsart|moduleDocsConsart|contractsConsart)/';
    `);
  }

  await run(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_name
      ON ${TABLE}(name);
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_is_active
      ON ${TABLE}(is_active);
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_parent_sort
      ON ${TABLE}(parent_id, sort_order);
  `);
}
