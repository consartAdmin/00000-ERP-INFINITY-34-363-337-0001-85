// ╔══════════════════════════════════════════════════════════════════════╗
// ║ voiceBudgetService.js — Orçamento por voz (Claude)                   ║
// ║ Recebe o texto falado no app (já transcrito no celular) e pede ao    ║
// ║ Claude para montar o rascunho do orçamento: cliente, produtos,       ║
// ║ quantidades e forma de pagamento. O Claude consulta o cadastro do    ║
// ║ ERP pelas ferramentas abaixo (mesmas buscas das telas), dentro do    ║
// ║ contexto da empresa da request (BH3 x CONSART).                      ║
// ║ Nada é gravado aqui: o app mostra o rascunho para conferência.       ║
// ║ ENV: ANTHROPIC_API_KEY (obrigatória, Secret Manager no Cloud Run)    ║
// ║      VOICE_BUDGET_MODEL (opcional, padrão claude-sonnet-5-5)         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import Anthropic from '@anthropic-ai/sdk';
import customersApi from '../repositories/customers/customers.index.js';
import productsApi from '../repositories/products/products.index.js';
import paymentMethodsApi from '../repositories/paymentMethods/paymentMethods.index.js';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_TURNS = 12;
const MAX_TEXT = 4000;

export class VoiceBudgetError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new VoiceBudgetError(
      'Orçamento por voz não configurado: falta ANTHROPIC_API_KEY no servidor.',
      503,
    );
  }
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

// ----------------------------------------------------------------------
// Busca tolerante: o ERP procura a frase inteira (ILIKE '%frase%'). Para
// "parafuso 6mm inox" buscamos pela palavra mais longa e filtramos as
// linhas que contêm todas as palavras (sem acento, sem maiúsculas).
// ----------------------------------------------------------------------
const norm = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();

function words(q) {
  return norm(q).split(/[^a-z0-9,.]+/).filter((w) => w.length >= 2);
}

async function tolerantSearch(q, run, textOf, limit) {
  const term = String(q ?? '').trim();
  if (!term) return [];
  const direct = await run(term, limit);
  const ws = words(term);
  if (direct.length || ws.length < 2) return direct.slice(0, limit);
  const key = [...ws].sort((a, b) => b.length - a.length)[0];
  const wide = await run(key, 200);
  const all = wide.filter((r) => {
    const t = norm(textOf(r));
    return ws.every((w) => t.includes(w));
  });
  // Sem linha com todas as palavras: devolve as da palavra principal.
  return (all.length ? all : wide).slice(0, limit);
}

const compact = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''),
);

// ----------------------------------------------------------------------
// Ferramentas que o Claude pode chamar
// ----------------------------------------------------------------------
const TOOLS = [
  {
    name: 'buscar_clientes',
    description:
      'Busca clientes ativos no cadastro do ERP por nome fantasia, razão social ou CNPJ/CPF. ' +
      'Use poucas palavras. A busca diferencia acentos: se não achar, tente com e sem acento ' +
      '(ex.: "são joão" e "sao joao") ou só uma palavra. Devolve até 10 clientes.',
    input_schema: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'Texto a procurar.' } },
      required: ['termo'],
      additionalProperties: false,
    },
  },
  {
    name: 'buscar_produtos',
    description:
      'Busca produtos ativos no ERP por descrição, código (SKU), referência do fabricante ou código de barras. ' +
      'As descrições costumam ser abreviadas e em maiúsculas (ex.: "PARAF SEXT 6MM ZINC"). ' +
      'Tente termos curtos e variações (singular, abreviação, medida como "6mm", com e sem acento). Devolve até 10 produtos.',
    input_schema: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'Texto a procurar.' } },
      required: ['termo'],
      additionalProperties: false,
    },
  },
  {
    name: 'listar_formas_pagamento',
    description: 'Lista as formas/condições de pagamento ativas cadastradas no ERP.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'entregar_rascunho',
    description:
      'Entrega o rascunho final do orçamento. Chame exatamente uma vez, no fim, ' +
      'depois de buscar o cliente, os produtos e a forma de pagamento.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: {
          type: ['string', 'null'],
          description: 'customer_id escolhido, ou null se não deu para identificar com segurança.',
        },
        cliente_falado: { type: 'string', description: 'Como o cliente foi falado.' },
        clientes_alternativos: {
          type: 'array',
          items: { type: 'string' },
          description: 'customer_id de outros candidatos plausíveis (no máximo 5).',
        },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              falado: { type: 'string', description: 'Trecho falado deste item.' },
              product_code: {
                type: ['string', 'null'],
                description: 'product_code escolhido, ou null se não achou.',
              },
              quantidade: { type: 'number' },
              alternativos: {
                type: 'array',
                items: { type: 'string' },
                description: 'product_code de outros candidatos plausíveis (no máximo 5).',
              },
              certeza: { type: 'string', enum: ['alta', 'media', 'baixa'] },
            },
            required: ['falado', 'product_code', 'quantidade', 'alternativos', 'certeza'],
            additionalProperties: false,
          },
        },
        forma_pagamento_id: {
          type: ['string', 'null'],
          description: 'paymentMethods_id escolhido, ou null se não foi falado ou não achou.',
        },
        forma_pagamento_falada: { type: 'string' },
        observacoes: {
          type: 'string',
          description: 'Observações faladas para o orçamento (vazio se nenhuma).',
        },
        perguntas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dúvidas curtas para o vendedor confirmar (vazio se nenhuma).',
        },
      },
      required: [
        'cliente_id', 'cliente_falado', 'clientes_alternativos', 'itens',
        'forma_pagamento_id', 'forma_pagamento_falada', 'observacoes', 'perguntas',
      ],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `Você monta rascunhos de orçamento de venda no ERP a partir do que o vendedor falou no celular.
O texto vem do reconhecimento de voz do celular, em português do Brasil: pode ter erros de transcrição, números por extenso ("dez", "duas dúzias" = 24, "meia dúzia" = 6) e nomes parecidos com o real.

Passos:
1. Identifique no texto o cliente, cada produto com a quantidade, a forma de pagamento e observações.
2. Use buscar_clientes para achar o cliente. Tente variações se não achar (só parte do nome, sem "mercado/loja/ltda").
3. Use buscar_produtos para cada produto. Tente termos curtos, abreviações e medidas. Escolha o produto que melhor corresponde ao que foi falado; se houver vários parecidos (cor, medida, acabamento), escolha o mais provável, liste os outros em alternativos e marque a certeza como "media" ou "baixa".
4. Use listar_formas_pagamento e escolha a que corresponde ao que foi falado ("trinta sessenta" = 30/60, "à vista", "pix", "boleto 28 dias").
5. Termine chamando entregar_rascunho uma única vez. Use somente ids e códigos que vieram das buscas. Nunca invente.

Quantidade não falada = 1. Se algo ficou ambíguo, escreva uma pergunta curta em perguntas. Não escreva texto fora das ferramentas.`;

function summarizeCustomer(r) {
  return compact({
    customer_id: String(r.customer_id),
    nome_fantasia: r.trade_name,
    razao_social: r.legal_name,
    cnpj_cpf: r.tax_id,
    cidade: [r.city, r.state].filter(Boolean).join('/'),
  });
}

function summarizeProduct(r) {
  return compact({
    product_code: String(r.product_code),
    descricao: r.description,
    ref_fabricante: r.manufacturer_ref,
    unidade: r.unit ?? r.unit_name ?? r.sale_unit,
    estoque: r.stock_qty != null ? Number(r.stock_qty) : null,
  });
}

/**
 * Interpreta o texto falado e devolve o rascunho com os registros completos
 * (cliente, produtos e forma de pagamento) que o app usa para abrir o editor.
 */
export async function interpretVoiceBudget({ text }) {
  const spoken = String(text ?? '').trim();
  if (!spoken) throw new VoiceBudgetError('Fale ou digite o orçamento.');
  if (spoken.length > MAX_TEXT) {
    throw new VoiceBudgetError('Texto muito longo. Divida em partes menores.');
  }

  const anthropic = getClient();
  const model = process.env.VOICE_BUDGET_MODEL || DEFAULT_MODEL;

  // Registros vistos nas buscas, para devolver ao app os dados completos.
  const seenCustomers = new Map();
  const seenProducts = new Map();
  let paymentMethods = null;

  const loadPaymentMethods = async () => {
    if (!paymentMethods) {
      const res = await paymentMethodsApi.list({ active: '1', limit: 500, offset: 0 });
      paymentMethods = (res?.rows ?? []).filter((r) => r.active !== false);
    }
    return paymentMethods;
  };

  async function runTool(name, input) {
    if (name === 'buscar_clientes') {
      const rows = await tolerantSearch(
        input?.termo,
        async (q, limit) => (await customersApi.search({ q, is_active: true, limit })).rows ?? [],
        (r) => `${r.trade_name ?? ''} ${r.legal_name ?? ''} ${r.tax_id ?? ''}`,
        10,
      );
      rows.forEach((r) => seenCustomers.set(String(r.customer_id), r));
      return rows.length ? rows.map(summarizeCustomer) : 'Nenhum cliente encontrado.';
    }
    if (name === 'buscar_produtos') {
      const rows = await tolerantSearch(
        input?.termo,
        async (q, limit) => (await productsApi.search({ q, limit })).rows ?? [],
        (r) => `${r.product_code ?? ''} ${r.description ?? ''} ${r.manufacturer_ref ?? ''}`,
        10,
      );
      rows.forEach((r) => seenProducts.set(String(r.product_code), r));
      return rows.length ? rows.map(summarizeProduct) : 'Nenhum produto encontrado.';
    }
    if (name === 'listar_formas_pagamento') {
      const rows = await loadPaymentMethods();
      return rows.map((r) => compact({
        paymentMethods_id: String(r.paymentMethods_id),
        nome: r.name,
        tipo: r.type,
        parcelas: r.installments,
      }));
    }
    throw new Error(`Ferramenta desconhecida: ${name}`);
  }

  const messages = [{ role: 'user', content: `Fala do vendedor:\n"""${spoken}"""` }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let draft = null;

  for (let turn = 0; turn < MAX_TURNS && !draft; turn += 1) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
      output_config: { effort: 'low' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'refusal') {
      throw new VoiceBudgetError('O Claude não conseguiu interpretar este pedido.', 422);
    }

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;

    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      messages.push({
        role: 'user',
        content: 'Termine chamando a ferramenta entregar_rascunho.',
      });
      continue;
    }

    const results = [];
    for (const call of calls) {
      if (call.name === 'entregar_rascunho') {
        draft = call.input;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: 'ok' });
        continue;
      }
      try {
        const out = await runTool(call.name, call.input);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
        });
      } catch (err) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Erro: ${err.message}`,
          is_error: true,
        });
      }
    }
    if (!draft) messages.push({ role: 'user', content: results });
  }

  if (!draft) {
    throw new VoiceBudgetError('Não consegui montar o orçamento. Tente falar de novo.', 422);
  }

  // Só devolve ids que vieram das buscas (o Claude não pode inventar).
  const customer = draft.cliente_id ? seenCustomers.get(String(draft.cliente_id)) ?? null : null;
  const customerAlternatives = (draft.clientes_alternativos ?? [])
    .map((id) => seenCustomers.get(String(id)))
    .filter(Boolean);

  const items = (draft.itens ?? []).map((it) => ({
    spoken: it.falado,
    quantity: Number(it.quantidade) > 0 ? Number(it.quantidade) : 1,
    confidence: it.certeza,
    product: it.product_code ? seenProducts.get(String(it.product_code)) ?? null : null,
    alternatives: (it.alternativos ?? [])
      .map((code) => seenProducts.get(String(code)))
      .filter(Boolean),
  }));

  let paymentMethod = null;
  if (draft.forma_pagamento_id) {
    const rows = await loadPaymentMethods();
    paymentMethod = rows.find(
      (r) => String(r.paymentMethods_id) === String(draft.forma_pagamento_id),
    ) ?? null;
  }

  return {
    ok: true,
    text: spoken,
    customer,
    customer_spoken: draft.cliente_falado ?? '',
    customer_alternatives: customerAlternatives,
    items,
    payment_method: paymentMethod,
    payment_spoken: draft.forma_pagamento_falada ?? '',
    notes: draft.observacoes ?? '',
    questions: draft.perguntas ?? [],
    model,
    usage,
  };
}
