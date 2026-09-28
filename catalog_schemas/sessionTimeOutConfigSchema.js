// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║ File: catalog_schemas/sessionTimeOutConfigSchema.js                           ║
// ║ Desc: Schema da tabela "sessionTimeOutConfig" — controle global de sessão.    ║
// ║ Autor: Renato Moreira / Atlas                                                 ║
// ║ ERP: CONSART                                                                 ║
// ║ Padrão: ESM — compatível com pgService.js                                    ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

export const sessionTimeOutConfigSchema = {
  name: 'sessionTimeOutConfig',
  description: 'Configuração global de tempo limite de sessão do sistema (session timeout).',

  columns: {
    id: {
      type: 'SMALLINT',
      primaryKey: true,
      notNull: true,
      default: 1,
      comment: 'Identificador único (sempre 1 — registro único de configuração global).'
    },
    enabled: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Define se o controle de timeout de sessão está ativo (true/false).'
    },
    idle_minutes: {
      type: 'INTEGER',
      notNull: true,
      default: 10,
      check: 'idle_minutes >= 1',
      comment: 'Tempo de inatividade (em minutos) antes da sessão expirar.'
    },
    warn_seconds: {
      type: 'INTEGER',
      notNull: true,
      default: 0,
      check: 'warn_seconds >= 0',
      comment: 'Tempo (em segundos) antes do logout para exibir o aviso de expiração.'
    },
    silent: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Se true, expira silenciosamente (sem alerta visual).'
    },
    redirect_url: {
      type: 'TEXT',
      notNull: true,
      default: "'/public/login/login.html'",
      comment: 'URL para onde o usuário será redirecionado ao expirar a sessão.'
    },
    updated_by: {
      type: 'TEXT',
      notNull: false,
      comment: 'Usuário responsável pela última atualização da configuração.'
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'now()',
      comment: 'Data/hora da última modificação da configuração.'
    }
  },

  // Índices, constraints e observações adicionais
  constraints: {
    primaryKey: ['id'],
    checks: [
      'idle_minutes >= 1',
      'warn_seconds >= 0'
    ]
  },

  comment:
    'Tabela única de configuração de timeout de sessão (sessionTimeOutConfig). ' +
    'Usada pelo módulo public/includes/sessionTimeout.js para controle automático de expiração.'
};
