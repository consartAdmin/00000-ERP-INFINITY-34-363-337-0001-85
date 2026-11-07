// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoController.js — Controller Uso e Consumo                  ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import * as api from '../repositories/usoConsumo/usoConsumo.index.js';

function ok(res, data = {}, extra = {}) {
  return res.json({
    ok: true,
    data,
    ...extra,
  });
}

function fail(res, status, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    message,
    ...extra,
  });
}

function resolveErrorStatus(error, fallback = 500) {
  const message = String(error?.message || '').toLowerCase();

  if (
    message.includes('não encontrado') ||
    message.includes('nao encontrado')
  ) {
    return 404;
  }

  if (
    message.includes('já possui') ||
    message.includes('ja possui') ||
    message.includes('duplicad')
  ) {
    return 409;
  }

  if (
    message.includes('inválido') ||
    message.includes('invalido') ||
    message.includes('obrigatório') ||
    message.includes('obrigatorio') ||
    message.includes('somente registros finalizados') ||
    message.includes('não possui itens') ||
    message.includes('nao possui itens') ||
    message.includes('não possui nf-e') ||
    message.includes('nao possui nf-e') ||
    message.includes('ainda não possui nf-e') ||
    message.includes('ainda nao possui nf-e') ||
    message.includes('identificador da plugnotas')
  ) {
    return 400;
  }

  if (
    message.includes('plugnotas') ||
    message.includes('sefaz') ||
    message.includes('emissão') ||
    message.includes('emissao') ||
    message.includes('consultar a nf-e')
  ) {
    return 502;
  }

  return fallback;
}

/* =========================================================================
 * 📋 Listar registros
 * ========================================================================= */

export async function list(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset || 0) || 0, 0);

    const result = await api.list({
      q: req.query.q || '',
      status: req.query.status || '',
      limit,
      offset,
    });

    return ok(res, result.rows, {
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error(
      '[usoConsumoController][list][ERROR]',
      error
    );

    return fail(
      res,
      500,
      error.message || 'Erro ao listar uso e consumo.'
    );
  }
}

/* =========================================================================
 * 🔎 Buscar registro por ID
 * ========================================================================= */

export async function getById(req, res) {
  try {
    const data = await api.getById(req.params.id);

    if (!data.header) {
      return fail(
        res,
        404,
        'Registro de uso e consumo não encontrado.'
      );
    }

    return ok(res, data);
  } catch (error) {
    console.error(
      '[usoConsumoController][getById][ERROR]',
      error
    );

    return fail(
      res,
      resolveErrorStatus(error),
      error.message || 'Erro ao buscar uso e consumo.'
    );
  }
}

/* =========================================================================
 * ✅ Finalizar orçamento como Uso e Consumo
 * ========================================================================= */

export async function finishBudget(req, res) {
  try {
    const data = await api.finishBudgetAsUsoConsumo(
      req.params.budgetId,
      req.body
    );

    return ok(res, data, {
      message:
        'Orçamento finalizado como Uso e Consumo com sucesso.',
    });
  } catch (error) {
    console.error(
      '[usoConsumoController][finishBudget][ERROR]',
      error
    );

    return fail(
      res,
      resolveErrorStatus(error, 400),
      error.message ||
      'Erro ao finalizar orçamento como Uso e Consumo.'
    );
  }
}

/* =========================================================================
 * 🧾 Emitir NF-e de Uso e Consumo
 * ========================================================================= */

export async function emitNfe(req, res) {
  try {
    const usoConsumoId = Number(req.params.id);

    if (!Number.isInteger(usoConsumoId) || usoConsumoId <= 0) {
      return fail(
        res,
        400,
        'uso_consumo_id inválido.'
      );
    }

    const data = await api.emitNfe(usoConsumoId);

    return ok(res, data, {
      message:
        'NF-e de Uso e Consumo enviada para processamento.',
    });
  } catch (error) {
    console.error(
      '[usoConsumoController][emitNfe][ERROR]',
      error
    );

    return fail(
      res,
      resolveErrorStatus(error),
      error.message ||
      'Erro ao emitir NF-e de Uso e Consumo.'
    );
  }
}

/* =========================================================================
 * 🔄 Consultar e atualizar o status da NF-e
 * ========================================================================= */

export async function refreshNfeStatus(req, res) {
  try {
    const usoConsumoId = Number(req.params.id);

    if (!Number.isInteger(usoConsumoId) || usoConsumoId <= 0) {
      return fail(
        res,
        400,
        'uso_consumo_id inválido.'
      );
    }

    const data = await api.refreshNfeStatus(usoConsumoId);

    const status =
      data?.invoice?.nfe_status ||
      data?.provider?.status ||
      'PROCESSANDO';

    let message =
      'Status da NF-e atualizado com sucesso.';

    if (status === 'AUTORIZADA') {
      message = 'NF-e autorizada pela SEFAZ.';
    } else if (status === 'REJEITADA') {
      const reason = data?.provider?.reason;
      message = reason
        ? `NF-e rejeitada. Motivo: ${reason}\nCorrija e use o botão Reenviar.`
        : 'NF-e rejeitada. Use o botão Reenviar depois de corrigir.';
    } else if (status === 'CANCELADA') {
      message = 'NF-e cancelada.';
    } else if (status === 'PROCESSANDO') {
      message = 'NF-e ainda está em processamento.';
    }

    return ok(res, data, {
      message,
    });
  } catch (error) {
    console.error(
      '[usoConsumoController][refreshNfeStatus][ERROR]',
      error
    );

    return fail(
      res,
      resolveErrorStatus(error),
      error.message ||
      'Erro ao consultar o status da NF-e.'
    );
  }
}

export async function retryNfe(req, res) {
  try {
    const data = await api.retryNfe(req.params.id);

    return ok(res, data, {
      message: 'NF-e reenviada para processamento.',
    });
  } catch (error) {
    console.error(
      '[usoConsumoController][retryNfe][ERROR]',
      error
    );

    return fail(
      res,
      resolveErrorStatus(error),
      error.message || 'Erro ao reenviar a NF-e.'
    );
  }
}

export async function printDanfe(req, res) {
  try {
    const data = await api.generateDanfeConsart(
      req.params.id
    );

    const filename = String(data.filename)
      .replace(/[\r\n"]/g, '')
      .replace(/[<>:/\\|?*]+/g, '-');

    res.status(200);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': data.buffer.length,
      'Content-Disposition':
        `inline; filename="${filename}"`,
      'Cache-Control':
        'private, no-store, max-age=0',
    });

    return res.end(data.buffer);
  } catch (error) {
    console.error(
      '[usoConsumoController][printDanfe][ERROR]',
      error
    );

    return fail(
      res,
      resolveErrorStatus(error),
      error.message ||
      'Erro ao gerar DANFE Consart.'
    );
  }
}
/* =========================================================================
 * Uso e Consumo direto (sem orçamento)
 * ========================================================================= */

function directStatus(error, fallback = 400) {
  const status = Number(error?.status || error?.statusCode);
  if (status >= 400 && status < 600) return status;
  return resolveErrorStatus(error, fallback);
}

export async function productInfo(req, res) {
  try {
    const data = await api.productInfo(req.params.productCode, {
      productGradeId: req.query.product_grade_id || null,
    });
    return ok(res, data);
  } catch (error) {
    console.error('[usoConsumoController][productInfo][ERROR]', error);
    return fail(res, directStatus(error), error.message || 'Erro ao carregar o produto.');
  }
}

export async function create(req, res) {
  try {
    let data = await api.saveDraft(null, req.body || {});
    const finishNow = req.body?.finish === true || req.body?.finish === 'true';

    if (finishNow) {
      try {
        data = await api.finish(data.header.uso_consumo_id);
      } catch (error) {
        // O rascunho fica salvo; devolve o motivo para o usuário corrigir.
        return fail(res, directStatus(error), error.message, { data });
      }
    }

    return ok(res, data, {
      message: finishNow
        ? 'Uso e consumo finalizado e estoque baixado.'
        : 'Rascunho salvo.',
    });
  } catch (error) {
    console.error('[usoConsumoController][create][ERROR]', error);
    return fail(res, directStatus(error), error.message || 'Erro ao salvar o uso e consumo.');
  }
}

export async function update(req, res) {
  try {
    let data = await api.saveDraft(req.params.id, req.body || {});
    const finishNow = req.body?.finish === true || req.body?.finish === 'true';

    if (finishNow) {
      try {
        data = await api.finish(req.params.id);
      } catch (error) {
        return fail(res, directStatus(error), error.message, { data });
      }
    }

    return ok(res, data, {
      message: finishNow
        ? 'Uso e consumo finalizado e estoque baixado.'
        : 'Rascunho salvo.',
    });
  } catch (error) {
    console.error('[usoConsumoController][update][ERROR]', error);
    return fail(res, directStatus(error), error.message || 'Erro ao salvar o uso e consumo.');
  }
}

export async function finish(req, res) {
  try {
    const data = await api.finish(req.params.id);
    return ok(res, data, { message: 'Uso e consumo finalizado e estoque baixado.' });
  } catch (error) {
    console.error('[usoConsumoController][finish][ERROR]', error);
    return fail(res, directStatus(error), error.message || 'Erro ao finalizar o uso e consumo.');
  }
}

export async function remove(req, res) {
  try {
    const data = await api.remove(req.params.id);
    return ok(res, data, {
      message: data.finished
        ? `Registro ${data.number} excluído e estoque estornado.`
        : `Rascunho ${data.number} excluído.`,
    });
  } catch (error) {
    console.error('[usoConsumoController][remove][ERROR]', error);
    return fail(res, directStatus(error), error.message || 'Erro ao excluir o uso e consumo.');
  }
}
