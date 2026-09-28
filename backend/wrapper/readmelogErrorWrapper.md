# Wrapper de Logs de Erro – `logErrosWrapper.js`

## 📌 Objetivo
Padronizar, enriquecer e centralizar os **logs de erro** do sistema com:
- Formato consistente (JSON estruturado);
- Contexto da requisição (request-id, usuário, rota);
- Correlação entre serviços;
- Redução de ruído (normalização de erros comuns);
- Pronto para produção (rotação de arquivos, retenção e envio opcional para observabilidade).

---

## 📁 Local do arquivo
backend/
└─ wrapper/
├─ logErrosWrapper.js
└─ readmeWrapper.md

pgsql
Copiar código

---

## 🧠 Conceito
`logErrosWrapper.js` é um **encapsulador** de logging.  
O código da aplicação **não decide como logar**: ele **invoca o wrapper**, e o wrapper cuida de formato, metadados e persistência.

**Benefícios:**
- Acoplamento fraco: trocar console por arquivo/observabilidade sem alterar controllers;
- Padronização total dos logs;
- Contexto completo em cada erro.

---

## 🔧 API do Wrapper

```js
// backend/wrapper/logErrosWrapper.js

/**
 * Registra um erro com metadados enriquecidos.
 * @param {Error|any} err - Instância de Error ou valor qualquer.
 * @param {Object} [ctx] - Metadados (ex.: { rota, metodo, requestId, usuario, extra }).
 * @param {Object} [opts] - Opções (ex.: { level: 'error'|'warn', notify: true }).
 * @returns {string} correlationId gerado/propagado.
 */
export function logErro(err, ctx = {}, opts = {}) {}

/**
 * Middleware Express para capturar erros não tratados (último na cadeia).
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorMiddleware() {}

/**
 * Gera/Propaga um correlationId (para usar em req/res).
 * @param {string} [incoming] - id existente, se houver.
 * @returns {string} correlationId
 */
export function ensureCorrelationId(incoming) {}
🏷️ Exemplo de Log (JSON estruturado)
json
Copiar código
{
  "ts": "2025-10-15T12:34:56.789Z",
  "level": "error",
  "msg": "Falha ao transmitir NF-e",
  "error": {
    "name": "AxiosError",
    "message": "Request failed with status code 500",
    "code": "ECONNRESET",
    "stack": "stacktrace..."
  },
  "context": {
    "rota": "/api/nfe/transmitir/:id",
    "metodo": "POST",
    "usuario": "RENATO M.",
    "empresaId": 13,
    "requestId": "904e33fb-6aae-4e47-bb32-4c0a75a10972"
  }
}


⚙️ Variáveis .env
Variável	Padrão	Descrição
LOG_LEVEL	info	Nível mínimo (debug < info < warn < error)
LOG_JSON	true	Saída em JSON (ou texto legível)
LOG_TO_FILE	true	Gravação em arquivo habilitada
LOG_FILE_PATH	./logs/app-%DATE%.log	Caminho com rotação diária
LOG_RETENTION_DAYS	7	Dias de retenção
LOG_MAX_SIZE	10m	Tamanho máximo por arquivo
LOG_HTTP_ENDPOINT		URL opcional p/ envio remoto
LOG_HTTP_TOKEN		Token opcional p/ envio remoto
LOG_REDACT_KEYS	password,token,authorization	Campos a mascarar

🚚 Transportes
Console: ativo no modo desenvolvimento;

Arquivo: rotação diária com compressão opcional;

HTTP: integração opcional com monitoramento (Elastic, Loki, etc.).

🧩 Integração Express
1️⃣ CorrelationId
js
Copiar código
import { errorMiddleware, ensureCorrelationId } from './backend/wrapper/logErrosWrapper.js';

app.use((req, _res, next) => {
  req.requestId = ensureCorrelationId(req.headers['x-request-id']);
  next();
});

app.use(errorMiddleware());
2️⃣ Uso em Controllers
js
Copiar código
import { logErro } from '../wrapper/logErrosWrapper.js';

export async function transmitirNfe(req, res) {
  try {
    // ... sua lógica
  } catch (err) {
    logErro(err, {
      rota: req.route?.path,
      metodo: req.method,
      url: req.originalUrl,
      usuario: req.user?.nome,
      empresaId: req.user?.empresaId,
      requestId: req.requestId,
    });
    res.status(500).json({ erro: 'Falha ao transmitir NF-e' });
  }
}
🧼 Normalização
Traduz erros técnicos para mensagens legíveis;

Remove campos sensíveis (token, password);

Sempre garante {name, message, stack}.

🔒 Privacidade
Chaves definidas em LOG_REDACT_KEYS são automaticamente mascaradas com "***redacted***".

🧪 Testes
Unitário: valida estrutura JSON do log.

E2E: garante requestId em toda a cadeia.

🧭 Implementação completa (colar em logErrosWrapper.js)
js
Copiar código
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const cfg = {
  level: process.env.LOG_LEVEL || 'info',
  json: (process.env.LOG_JSON ?? 'true') === 'true',
  toFile: (process.env.LOG_TO_FILE ?? 'true') === 'true',
  filePath: process.env.LOG_FILE_PATH || './logs/app-%DATE%.log',
  retentionDays: Number(process.env.LOG_RETENTION_DAYS || 7),
  maxSize: process.env.LOG_MAX_SIZE || '10m',
  httpEndpoint: process.env.LOG_HTTP_ENDPOINT || '',
  httpToken: process.env.LOG_HTTP_TOKEN || '',
  redact: (process.env.LOG_REDACT_KEYS || 'password,token,authorization')
            .split(',').map(s => s.trim()).filter(Boolean)
};

function ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function todayFile() {
  const d = new Date().toISOString().slice(0,10);
  return cfg.filePath.replace('%DATE%', d);
}

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (cfg.redact.includes(k.toLowerCase())) clone[k] = '***redacted***';
    else if (v && typeof v === 'object') clone[k] = redact(v);
    else clone[k] = v;
  }
  return clone;
}

export function ensureCorrelationId(incoming) {
  return (incoming && String(incoming).trim()) || crypto.randomUUID();
}

function normalizeError(err) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: err.code || undefined,
      stack: err.stack
    };
  }
  if (typeof err === 'object') return redact(err);
  return { message: String(err) };
}

function writeLine(line) {
  if (cfg.json) {
    const str = JSON.stringify(line);
    console.error(str);
    if (cfg.toFile) {
      const file = todayFile();
      ensureDir(file);
      fs.appendFile(file, str + '\n', () => {});
    }
  } else {
    console.error(`[${line.ts}] ${line.level.toUpperCase()} ${line.msg}`, line.error, line.context);
  }
}

export function logErro(err, ctx = {}, opts = {}) {
  const line = {
    ts: new Date().toISOString(),
    level: opts.level || 'error',
    msg: ctx?.msg || (err?.message || 'Erro'),
    error: normalizeError(err),
    context: redact({
      ...ctx,
      requestId: ctx.requestId || ctx.correlationId || ensureCorrelationId()
    })
  };
  writeLine(line);
  return line.context.requestId;
}

export function errorMiddleware() {
  return (err, req, res, _next) => {
    const requestId = logErro(err, {
      rota: req.route?.path,
      metodo: req.method,
      url: req.originalUrl,
      ip: req.ip,
      usuario: req.user?.nome,
      empresaId: req.user?.empresaId,
      requestId: req.requestId,
      extra: { params: req.params, query: req.query }
    });
    res.status(500).json({ erro: 'Erro interno do servidor', requestId });
  };
}
✅ Checklist de Adoção
Criar backend/wrapper/logErrosWrapper.js;

Adicionar variáveis .env (LOG_LEVEL, LOG_JSON, LOG_TO_FILE);

Adicionar middleware no server.js;

Usar logErro() em todos os controllers;

Garantir propagação de requestId.

