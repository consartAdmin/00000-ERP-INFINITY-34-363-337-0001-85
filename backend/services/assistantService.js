// ╔══════════════════════════════════════════════════════════════════════╗
// ║ assistantService.js — Consart, a assistente de IA do ERP (por voz)   ║
// ║ Recebe a pergunta falada no app (já transcrita no celular) e pede ao ║
// ║ Claude para responder consultando os módulos do ERP pelas            ║
// ║ ferramentas abaixo. SOMENTE LEITURA: nenhuma ferramenta grava nada.  ║
// ║ Produtos e clientes usam os repositórios (mesma busca do orçamento   ║
// ║ por voz). Os outros módulos são lidos pelas próprias rotas GET do    ║
// ║ ERP (chamada interna em 127.0.0.1), com o token e a empresa          ║
// ║ (X-ERP-Company) de quem perguntou: mesmas regras e permissões das    ║
// ║ telas. Só rotas GET listadas aqui (nada genérico).                   ║
// ║ ENV: ANTHROPIC_API_KEY (obrigatória, Secret Manager no Cloud Run)    ║
// ║      ASSISTANT_MODEL (opcional, padrão claude-sonnet-5-5)            ║
// ║      ASSISTANT_DAILY_LIMIT (opcional, perguntas/usuário/dia, 150)    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import Anthropic from '@anthropic-ai/sdk';
import customersApi from '../repositories/customers/customers.index.js';
import productsApi from '../repositories/products/products.index.js';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_TURNS = 10;
const MAX_TEXT = 2000;
const MAX_HISTORY = 16;
const MAX_TOOL_CHARS = 12_000;

export class AssistantError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AssistantError('Assistente não configurada: falta ANTHROPIC_API_KEY no servidor.', 503);
  }
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

// ----------------------------------------------------------------------
// Limite diário por usuário (em memória, por instância do Cloud Run).
// Evita surpresa na conta da API se o app ficar preso num loop.
// ----------------------------------------------------------------------
const usageByDay = new Map();
export function checkDailyLimit(userId) {
  const limit = Number(process.env.ASSISTANT_DAILY_LIMIT) || 150;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${userId ?? '?'}`;
  for (const k of usageByDay.keys()) if (!k.startsWith(day)) usageByDay.delete(k);
  const n = (usageByDay.get(key) ?? 0) + 1;
  if (n > limit) {
    throw new AssistantError(`Limite de ${limit} perguntas por dia atingido. Volte amanhã.`, 429);
  }
  usageByDay.set(key, n);
}

// ----------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------
const norm = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();

const words = (q) => norm(q).split(/[^a-z0-9,.]+/).filter((w) => w.length >= 2);

const compact = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''),
);

/** Busca tolerante (frase inteira; senão a palavra mais longa filtrando as outras). */
async function tolerantSearch(q, run, textOf, limit) {
  const term = String(q ?? '').trim();
  if (!term) return [];
  const direct = await run(term, limit);
  const ws = words(term);
  if (direct.length || ws.length < 2) return direct.slice(0, limit);
  const key = [...ws].sort((a, b) => b.length - a.length)[0];
  const wide = await run(key, 200);
  const all = wide.filter((r) => ws.every((w) => norm(textOf(r)).includes(w)));
  return (all.length ? all : wide).slice(0, limit);
}

// Campos pesados ou inúteis para conversa (imagens, XML, PDFs, blobs).
const DROP_KEY = /(png|jpe?g|base64|xml|pdf|image|photo|signature|blob|html|password|token|hash|lots)$/i;

/** Reduz o JSON de uma rota do ERP para caber no contexto do Claude. */
function shrink(value, depth = 0) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 5) return undefined;
  if (Array.isArray(value)) {
    const items = value.slice(0, 30).map((v) => shrink(v, depth + 1)).filter((v) => v !== undefined);
    if (value.length > 30) items.push(`… mais ${value.length - 30} itens`);
    return items;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEY.test(k)) continue;
    const s = shrink(v, depth + 1);
    if (s !== undefined && s !== '') out[k] = s;
  }
  return out;
}

function toToolText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(shrink(value));
  return text.length > MAX_TOOL_CHARS
    ? `${text.slice(0, MAX_TOOL_CHARS)}… (resposta cortada: refine o filtro ou o período)`
    : text;
}

/** GET numa rota do próprio ERP, com o login e a empresa de quem perguntou. */
async function erpGet(ctx, path, query = {}) {
  const port = process.env.PORT || 8080;
  const url = new URL(path, `http://127.0.0.1:${port}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') url.searchParams.set(k, String(v));
  }
  const headers = { accept: 'application/json' };
  if (ctx.authorization) headers.authorization = ctx.authorization;
  if (ctx.company) headers['x-erp-company'] = ctx.company;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) {
    const msg = body?.error || body?.message || `HTTP ${res.status}`;
    throw new Error(`Rota ${path} falhou: ${msg}`);
  }
  return body;
}

const str = (desc) => ({ type: 'string', description: desc });
const date = (desc) => ({ type: 'string', description: `${desc} (AAAA-MM-DD)` });
const obj = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});

// ----------------------------------------------------------------------
// Ferramentas (todas de leitura)
// ----------------------------------------------------------------------
const TOOLS = [
  {
    name: 'buscar_produtos',
    description:
      'Busca produtos no cadastro por descrição, código (SKU), referência do fabricante ou código de barras. ' +
      'Devolve estoque atual, unidade, localização e preço de varejo. Descrições costumam ser abreviadas e em maiúsculas: ' +
      'tente termos curtos e variações (singular, abreviação, com e sem acento). Até 10 produtos.',
    input_schema: obj({ termo: str('Texto a procurar.') }, ['termo']),
  },
  {
    name: 'buscar_clientes',
    description:
      'Busca clientes por nome fantasia, razão social ou CNPJ/CPF. Devolve o customer_id, usado em outras ferramentas. ' +
      'Se não achar, tente parte do nome, com e sem acento. Até 10 clientes.',
    input_schema: obj({ termo: str('Texto a procurar.') }, ['termo']),
  },
  {
    name: 'relatorio_vendas',
    description:
      'Relatório de vendas (notas fiscais emitidas) num período: totais, quantidade, ticket, por cliente/produto/vendedor. ' +
      'Use para "quanto vendemos", "maiores clientes", "produtos mais vendidos". Pode filtrar por customer_id.',
    input_schema: obj({
      data_inicio: date('Início'),
      data_fim: date('Fim'),
      cliente_id: str('customer_id (opcional)'),
    }, ['data_inicio', 'data_fim']),
  },
  {
    name: 'contas_a_pagar',
    description:
      'Contas a pagar (fornecedores e compromissos). Filtre por vencimento e status. ' +
      'status: "EM_ABERTO" (ainda não pagas), "VENCIDO" (em aberto e já vencidas), "PAGO" ou vazio para todas.',
    input_schema: obj({
      vencimento_de: date('Vencimento a partir de'),
      vencimento_ate: date('Vencimento até'),
      status: str('EM_ABERTO | VENCIDO | PAGO | vazio'),
      busca: str('Fornecedor ou descrição (opcional)'),
    }),
  },
  {
    name: 'contas_a_receber',
    description:
      'Contas a receber de clientes (títulos/boletos). Filtre por vencimento, status e cliente. ' +
      'status: "EM_ABERTO" (a receber), "VENCIDO" (atrasadas), "PAGO" (recebidas) ou vazio para todas.',
    input_schema: obj({
      vencimento_de: date('Vencimento a partir de'),
      vencimento_ate: date('Vencimento até'),
      status: str('EM_ABERTO | VENCIDO | PAGO | vazio'),
      busca: str('Cliente ou documento (opcional)'),
    }),
  },
  {
    name: 'resumo_contas_a_receber',
    description: 'Resumo geral das contas a receber: totais em aberto, vencidos e recebidos.',
    input_schema: obj({}),
  },
  {
    name: 'caixa',
    description:
      'Caixa da empresa. consulta="saldos": saldo de cada conta no mês atual. ' +
      'consulta="resumo": total de entradas, saídas e saldo num período. ' +
      'consulta="movimentos": lançamentos do período (filtre por tipo ENTRADA/SAIDA e busca).',
    input_schema: obj({
      consulta: { type: 'string', enum: ['saldos', 'resumo', 'movimentos'] },
      data_de: date('Início (resumo/movimentos)'),
      data_ate: date('Fim (resumo/movimentos)'),
      tipo: str('ENTRADA | SAIDA | vazio'),
      busca: str('Texto (opcional)'),
    }, ['consulta']),
  },
  {
    name: 'dividas',
    description:
      'Dívidas e financiamentos da empresa. consulta="resumo": total em aberto, vencido e pago. ' +
      'consulta="lista": dívidas com status EM_ABERTO, PARCIAL, PAGO ou VENCIDO.',
    input_schema: obj({
      consulta: { type: 'string', enum: ['resumo', 'lista'] },
      status: str('EM_ABERTO | PARCIAL | PAGO | VENCIDO | vazio'),
      busca: str('Credor ou descrição (opcional)'),
    }, ['consulta']),
  },
  {
    name: 'orcamentos',
    description:
      'Busca orçamentos de venda por cliente, número ou período. Devolve número, cliente, data, status e total.',
    input_schema: obj({
      busca: str('Cliente ou número (opcional)'),
      data_de: date('Início (opcional)'),
      data_ate: date('Fim (opcional)'),
    }),
  },
  {
    name: 'detalhe_orcamento',
    description: 'Detalhe de um orçamento (itens, quantidades, valores, pagamento) pelo número.',
    input_schema: obj({ numero: str('Número do orçamento (budget_id)') }, ['numero']),
  },
  {
    name: 'pedidos',
    description: 'Busca pedidos de venda por cliente, número, status ou período.',
    input_schema: obj({
      busca: str('Cliente ou número (opcional)'),
      status: str('Status (opcional)'),
      data_de: date('Início (opcional)'),
      data_ate: date('Fim (opcional)'),
    }),
  },
  {
    name: 'entregas',
    description:
      'Viagens de entrega (rotas): motorista, veículo, status (PLANEJADA, EM_ROTA, CONCLUIDA, CANCELADA) e paradas. ' +
      'Passe viagem_id para ver as paradas de uma viagem (entregues, pendentes, falhas).',
    input_schema: obj({
      viagem_id: str('Id da viagem para ver o detalhe (opcional)'),
      status: str('PLANEJADA | EM_ROTA | CONCLUIDA | CANCELADA | vazio'),
      data_de: date('Início (opcional)'),
      data_ate: date('Fim (opcional)'),
      busca: str('Motorista, placa ou nome da viagem (opcional)'),
    }),
  },
  {
    name: 'notas_de_entrada',
    description: 'Notas fiscais de entrada (compras de fornecedores) por fornecedor, número ou período.',
    input_schema: obj({
      busca: str('Fornecedor ou número (opcional)'),
      data_de: date('Início (opcional)'),
      data_ate: date('Fim (opcional)'),
    }),
  },
  {
    name: 'responder',
    description:
      'Entrega a resposta final ao usuário. Chame exatamente uma vez, no fim, depois de consultar o que precisar.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        fala: {
          type: 'string',
          description:
            'O que o celular vai falar em voz alta: 1 a 3 frases curtas, português do Brasil, natural como uma conversa. ' +
            'Valores por extenso amigável ("dezoito mil e quatrocentos reais"), sem códigos, sem listas longas.',
        },
        destaques: {
          type: 'array',
          description: 'Até 6 números ou fatos para mostrar na tela (vazio se não houver).',
          items: {
            type: 'object',
            properties: {
              rotulo: { type: 'string', description: 'Ex.: "Vendas hoje"' },
              valor: { type: 'string', description: 'Ex.: "R$ 18.430,00"' },
            },
            required: ['rotulo', 'valor'],
            additionalProperties: false,
          },
        },
        fontes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Módulos consultados, ex.: ["Produtos", "Notas de Entrada"].',
        },
      },
      required: ['fala', 'destaques', 'fontes'],
      additionalProperties: false,
    },
  },
];

function systemPrompt(userName) {
  const now = new Date();
  const hoje = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const semana = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' });
  return `Você é a Consart, a assistente de IA do ERP da empresa. Conversa por voz com ${userName || 'o usuário'} pelo celular.
Hoje é ${semana}, ${hoje} (horário de Brasília).

Você responde perguntas sobre qualquer módulo do ERP: produtos e estoque, clientes, vendas, orçamentos, pedidos, contas a pagar, contas a receber, caixa, dívidas, entregas e notas de entrada.
A pergunta vem do reconhecimento de voz do celular: pode ter erros de transcrição e números por extenso.

Regras:
- Sempre consulte as ferramentas antes de afirmar qualquer número. Nunca invente dados.
- Converta datas relativas ("hoje", "essa semana", "mês passado") em datas reais a partir de hoje.
- Você só consulta: não consegue criar, alterar, baixar ou excluir nada. Se pedirem, explique com gentileza e diga em qual app ou tela fazer.
- Se a pergunta for ambígua, responda o mais provável e diga o que assumiu, ou faça uma pergunta curta.
- Se uma ferramenta falhar ou não trouxer dados, diga isso com franqueza.
- Pode conversar sobre assuntos gerais de gestão, mas o foco é a empresa.
Termine sempre chamando responder uma única vez. Em fala, seja calorosa e direta, como uma colega que conhece a empresa.`;
}

/** Histórico do app ([{role:'user'|'assistant', text}]) → mensagens alternadas. */
function normalizeHistory(history) {
  const out = [];
  const list = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
  for (const h of list) {
    const role = h?.role === 'assistant' ? 'assistant' : 'user';
    const text = String(h?.text ?? '').trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}

async function runTool(ctx, name, input = {}) {
  switch (name) {
    case 'buscar_produtos': {
      const rows = await tolerantSearch(
        input.termo,
        async (q, limit) => (await productsApi.search({ q, limit })).rows ?? [],
        (r) => `${r.product_code ?? ''} ${r.description ?? ''} ${r.manufacturer_ref ?? ''}`,
        10,
      );
      if (!rows.length) return 'Nenhum produto encontrado.';
      return rows.map((r) => compact({
        codigo: String(r.product_code),
        descricao: r.description,
        ref_fabricante: r.manufacturer_ref,
        unidade: r.unit ?? r.unit_name ?? r.sale_unit,
        estoque: r.stock_qty != null ? Number(r.stock_qty) : null,
        preco_varejo: r.price_varejo != null ? Number(r.price_varejo) : null,
        localizacao: r.location_description,
        ativo: r.active === false || r.is_active === false ? false : null,
      }));
    }
    case 'buscar_clientes': {
      const rows = await tolerantSearch(
        input.termo,
        async (q, limit) => (await customersApi.search({ q, limit })).rows ?? [],
        (r) => `${r.trade_name ?? ''} ${r.legal_name ?? ''} ${r.tax_id ?? ''}`,
        10,
      );
      if (!rows.length) return 'Nenhum cliente encontrado.';
      return rows.map((r) => compact({
        customer_id: String(r.customer_id),
        nome_fantasia: r.trade_name,
        razao_social: r.legal_name,
        cnpj_cpf: r.tax_id,
        cidade: [r.city, r.state].filter(Boolean).join('/'),
        telefone: r.phone ?? r.mobile,
        ativo: r.is_active === false ? false : null,
      }));
    }
    case 'relatorio_vendas':
      return erpGet(ctx, '/api/reports/sales', {
        dateStart: input.data_inicio, dateEnd: input.data_fim, customerId: input.cliente_id,
      });
    case 'contas_a_pagar': {
      // No contas a pagar o status gravado é PENDING/PAID; "vencida" = PENDING com vencimento passado.
      const st = String(input.status ?? '').toUpperCase();
      let toDue = input.vencimento_ate;
      const status = { EM_ABERTO: 'PENDING', VENCIDO: 'PENDING', PAGO: 'PAID' }[st] ?? '';
      if (st === 'VENCIDO') {
        const ontem = new Date(Date.now() - 86_400_000)
          .toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
        if (!toDue || toDue > ontem) toDue = ontem;
      }
      return erpGet(ctx, '/api/accounts-payable', {
        fromDueDate: input.vencimento_de, toDueDate: toDue,
        status, search: input.busca, pageSize: 50,
      });
    }
    case 'contas_a_receber': {
      const st = String(input.status ?? '').toUpperCase();
      return erpGet(ctx, '/api/accounts-receivable', {
        fromDueDate: input.vencimento_de, toDueDate: input.vencimento_ate,
        status: { EM_ABERTO: 'PENDING', VENCIDO: 'OVERDUE', PAGO: 'PAID' }[st] ?? '',
        search: input.busca, pageSize: 50,
      });
    }
    case 'resumo_contas_a_receber':
      return erpGet(ctx, '/api/accounts-receivable-reports/summary');
    case 'caixa': {
      if (input.consulta === 'saldos') return erpGet(ctx, '/api/caixa/saldos');
      const q = {
        date_from: input.data_de, date_to: input.data_ate, tipo: input.tipo, search: input.busca,
      };
      if (input.consulta === 'resumo') return erpGet(ctx, '/api/caixa/summary', q);
      return erpGet(ctx, '/api/caixa/movimentacoes', { ...q, pageSize: 50 });
    }
    case 'dividas':
      if (input.consulta === 'resumo') return erpGet(ctx, '/api/debts/summary');
      return erpGet(ctx, '/api/debts', { status: input.status, search: input.busca });
    case 'orcamentos':
      return erpGet(ctx, '/api/budgets/search', {
        q: input.busca, dateFrom: input.data_de, dateTo: input.data_ate, limit: 20,
      });
    case 'detalhe_orcamento': {
      const id = String(input.numero ?? '').replace(/\D/g, '');
      if (!id) return 'Informe o número do orçamento.';
      return erpGet(ctx, `/api/budgets/${id}`);
    }
    case 'pedidos':
      return erpGet(ctx, '/api/orders', {
        q: input.busca, status: input.status, dateFrom: input.data_de, dateTo: input.data_ate, limit: 20,
      });
    case 'entregas': {
      const id = String(input.viagem_id ?? '').replace(/\D/g, '');
      if (id) return erpGet(ctx, `/api/delivery-trips/${id}`);
      return erpGet(ctx, '/api/delivery-trips', {
        status: input.status, date_from: input.data_de, date_to: input.data_ate, q: input.busca, limit: 30,
      });
    }
    case 'notas_de_entrada':
      return erpGet(ctx, '/api/inbound-invoices', {
        search: input.busca, dateFrom: input.data_de, dateTo: input.data_ate, limit: 30,
      });
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

/**
 * Responde uma pergunta. ctx = { authorization, company, userName }.
 * Devolve { reply, highlights, sources, usage, model }.
 */
export async function askAssistant({ text, history = [] }, ctx = {}) {
  const question = String(text ?? '').trim();
  if (!question) throw new AssistantError('Faça uma pergunta.');
  if (question.length > MAX_TEXT) throw new AssistantError('Pergunta muito longa. Tente resumir.');

  const anthropic = getClient();
  const model = process.env.ASSISTANT_MODEL || DEFAULT_MODEL;
  const messages = [...normalizeHistory(history), { role: 'user', content: question }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const toolsUsed = [];
  let answer = null;

  for (let turn = 0; turn < MAX_TURNS && !answer; turn += 1) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 4000,
      system: systemPrompt(ctx.userName),
      tools: TOOLS,
      messages,
      output_config: { effort: 'low' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'refusal') {
      throw new AssistantError('Não posso ajudar com esse pedido.', 422);
    }
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;

    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      // Respondeu em texto livre: aproveita como fala.
      const plain = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      if (plain) {
        answer = { fala: plain, destaques: [], fontes: [] };
        break;
      }
      messages.push({ role: 'user', content: 'Termine chamando a ferramenta responder.' });
      continue;
    }

    const results = [];
    for (const call of calls) {
      if (call.name === 'responder') {
        answer = call.input;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: 'ok' });
        continue;
      }
      toolsUsed.push(call.name);
      try {
        const out = await runTool(ctx, call.name, call.input);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: toToolText(out) });
      } catch (err) {
        results.push({
          type: 'tool_result', tool_use_id: call.id, content: `Erro: ${err.message}`, is_error: true,
        });
      }
    }
    if (!answer) messages.push({ role: 'user', content: results });
  }

  if (!answer) throw new AssistantError('Não consegui responder agora. Tente perguntar de outro jeito.', 422);

  return {
    ok: true,
    question,
    reply: String(answer.fala ?? '').trim(),
    highlights: (answer.destaques ?? []).slice(0, 6).map((d) => ({
      label: String(d.rotulo ?? ''), value: String(d.valor ?? ''),
    })),
    sources: (answer.fontes ?? []).map(String).slice(0, 6),
    tools: toolsUsed,
    model,
    usage,
  };
}
