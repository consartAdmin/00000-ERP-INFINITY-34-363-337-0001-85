// ╔════════════════════════════════════════════════════════════════════╗
// ║ modulePasswords.catalog.js — Senhas usadas pelo sistema            ║
// ║ Cada item vira uma linha em public."modulePasswords" (sem senha).  ║
// ║ Para proteger uma nova ação: adicione aqui e chame                 ║
// ║ verifyModulePassword(module_code, action_code, ...) na rota.       ║
// ╚════════════════════════════════════════════════════════════════════╝

export const MODULE_PASSWORDS_CATALOG = Object.freeze([
  {
    module_code: 'CUSTOMERS',
    action_code: 'EXPORT',
    description: 'Listagem de Clientes — Exportar PDF/Excel',
  },
  {
    module_code: 'BUDGETS',
    action_code: 'TO_ORDER',
    description: 'Orçamentos — Transformar em Pedido',
    // Ao criar a linha pela 1ª vez, já nasce com a senha atual do .env
    // (BUDGET_TO_ORDER_KEY) e inativa se BUDGET_TO_ORDER_KEY_ENABLED=false.
    // Depois disso, vale só o que estiver em Senhas de Módulos.
    seed_from_env: 'BUDGET_TO_ORDER_KEY',
    seed_enabled_env: 'BUDGET_TO_ORDER_KEY_ENABLED',
  },
]);
