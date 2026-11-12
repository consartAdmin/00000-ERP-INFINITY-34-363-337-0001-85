// ╔════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoDanfe.repository.js — generateDanfeConsart               ║
// ║ Baixa o XML no provedor (API Consart/PlugNotas) e gera o DANFE     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

import { generateDanfeFromXml } from '../../services/danfeConsartService.js';
import { obterXml } from '../nfe/nfe.index.js';

export async function generateDanfeConsart(usoConsumoId) {
  const id = Number(usoConsumoId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('uso_consumo_id inválido.');
  }

  const { rows } = await pool.query(
    `
      SELECT
        uc.uso_consumo_id,
        uc.number AS uso_consumo_number,
        uc.department,
        uc.responsible,
        uc.reason,

        ii.invoice_id,
        ii.nfe_number,
        ii.nfe_key,
        ii.nfe_status,
        ii.nfe_protocol,
        ii.nfe_provider_id
      FROM public."usoConsumo" uc
      INNER JOIN public."invoicesIssued" ii
        ON ii.invoice_id = uc.invoice_id
      WHERE uc.uso_consumo_id = $1::bigint
      LIMIT 1
    `,
    [id]
  );

  const invoice = rows[0];

  if (!invoice) {
    throw new Error(
      'Uso e Consumo ou NF-e vinculada não encontrado.'
    );
  }

  if (
    String(invoice.nfe_status || '').toUpperCase() !==
    'AUTORIZADA'
  ) {
    throw new Error(
      'O DANFE somente pode ser gerado para uma NF-e autorizada.'
    );
  }

  if (!invoice.nfe_provider_id) {
    throw new Error(
      'Identificador da NF-e no provedor não encontrado.'
    );
  }

  // XML pelo provedor da nota: chave de 44 dígitos = API Consart; senão PlugNotas.
  const xmlResult = await obterXml(String(invoice.nfe_provider_id).trim());

  if (!xmlResult?.ok) {
    console.error(
      '[usoConsumoApi][generateDanfeConsart][XML ERROR]',
      { status: xmlResult?.status, error: xmlResult?.error }
    );

    throw new Error(
      `Erro ao baixar o XML da NF-e: HTTP ${xmlResult?.status || '?'}.`
    );
  }

  const xmlContent = String(xmlResult.xml || '');

  if (
    !xmlContent ||
    (
      !xmlContent.includes('<NFe') &&
      !xmlContent.includes('<nfeProc')
    )
  ) {
    throw new Error(
      'O provedor de NF-e não retornou um XML válido.'
    );
  }

  const danfe = await generateDanfeFromXml({
    numero: String(invoice.nfe_number || ''),
    serie: String(process.env.NFE_SERIE || '1'),
    chave: String(invoice.nfe_key || ''),
    xmlContent,

    prot: {
      protocolo: invoice.nfe_protocol || '',
    },

    complementaryInfo: [
      'RETIRADA DE MERCADORIAS PARA USO E CONSUMO INTERNO.',
      `CONTROLE INTERNO: ${invoice.uso_consumo_number || id
      }.`,
      `DEPARTAMENTO: ${invoice.department || 'NÃO INFORMADO'
      }.`,
      `RESPONSÁVEL: ${invoice.responsible || 'NÃO INFORMADO'
      }.`,
      invoice.reason
        ? `MOTIVO: ${String(invoice.reason).trim()}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  });

  if (!Buffer.isBuffer(danfe?.buffer)) {
    throw new Error(
      'O gerador Consart não retornou um PDF válido.'
    );
  }

  return {
    buffer: danfe.buffer,
    filename:
      danfe.filename ||
      `DANFE-NFE-${invoice.nfe_number || id}.pdf`,
  };
}
