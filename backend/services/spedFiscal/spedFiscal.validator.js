// ╔══════════════════════════════════════════════════════════════════════╗
// ║ spedFiscal.validator.js                                             ║
// ║ Descrição: Validação interna do SPED Fiscal                         ║
// ║ Projeto: CONSART ERP                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

function pushIssue(issues, {
  type = 'erro',
  bloco = '',
  registro = '',
  chave_ref = '',
  mensagem = '',
}) {
  issues.push({ type, bloco, registro, chave_ref, mensagem });
}

export function validateSpedContext(ctx) {
  const issues = [];

  const company = ctx?.company || {};
  const participants = Array.isArray(ctx?.participants) ? ctx.participants : [];
  const products = Array.isArray(ctx?.products) ? ctx.products : [];
  const documents = Array.isArray(ctx?.documents) ? ctx.documents : [];

  if (!company.razao_social) {
    pushIssue(issues, {
      type: 'erro',
      bloco: '0',
      registro: '0000',
      mensagem: 'Razão social da empresa não informada.',
    });
  }

  if (!company.cnpj) {
    pushIssue(issues, {
      type: 'erro',
      bloco: '0',
      registro: '0000',
      mensagem: 'CNPJ da empresa não informado.',
    });
  }

  if (!company.uf) {
    pushIssue(issues, {
      type: 'erro',
      bloco: '0',
      registro: '0000',
      mensagem: 'UF da empresa não informada.',
    });
  }

  if (!company.ie) {
    pushIssue(issues, {
      type: 'alerta',
      bloco: '0',
      registro: '0000',
      mensagem: 'Inscrição estadual da empresa não informada.',
    });
  }

  // Registro 0100 (contabilista) é obrigatório: avisar já na prévia/validação,
  // em vez de só estourar no Gerar TXT. Dados em Empresas → Contabilista.
  const accountantChecks = [
    ['NOME', String(company.accountant_name || '').trim(), v => Boolean(v)],
    ['CPF', String(company.accountant_cpf || '').replace(/\D+/g, ''), v => /^\d{11}$/.test(v)],
    ['CRC', String(company.accountant_crc || '').trim(), v => Boolean(v) && v.length <= 15],
    ['E-MAIL', String(company.accountant_email || '').trim(), v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)],
    ['Código IBGE do município (Endereço da empresa)', String(company.cod_mun || '').replace(/\D+/g, ''), v => /^\d{7}$/.test(v)],
  ];

  for (const [field, value, isValid] of accountantChecks) {
    if (!isValid(value)) {
      pushIssue(issues, {
        type: 'erro',
        bloco: '0',
        registro: '0100',
        mensagem: `${field} do contabilista não informado ou inválido (cadastre em Empresas → Contabilista).`,
      });
    }
  }

  for (const p of participants) {
    if (!p.codigo) {
      pushIssue(issues, {
        type: 'erro',
        bloco: '0',
        registro: '0150',
        chave_ref: p.nome || '',
        mensagem: 'Participante sem código.',
      });
    }

    if (!p.nome) {
      pushIssue(issues, {
        type: 'erro',
        bloco: '0',
        registro: '0150',
        chave_ref: p.codigo || '',
        mensagem: 'Participante sem nome.',
      });
    }

    if (!String(p.cod_mun || '').trim()) {
      pushIssue(issues, {
        type: 'alerta',
        bloco: '0',
        registro: '0150',
        chave_ref: `${p.codigo || ''} ${p.nome || ''}`.trim(),
        mensagem: 'Participante sem código IBGE do município (confira cidade/UF no cadastro).',
      });
    }

    if (!p.cnpj && !p.cpf) {
      pushIssue(issues, {
        type: 'alerta',
        bloco: '0',
        registro: '0150',
        chave_ref: p.codigo || '',
        mensagem: 'Participante sem CPF/CNPJ.',
      });
    }
  }

  for (const prod of products) {
    if (!prod.codigo) {
      pushIssue(issues, {
        type: 'erro',
        bloco: '0',
        registro: '0200',
        chave_ref: prod.descricao || '',
        mensagem: 'Produto sem código.',
      });
    }

    if (!prod.descricao) {
      pushIssue(issues, {
        type: 'erro',
        bloco: '0',
        registro: '0200',
        chave_ref: prod.codigo || '',
        mensagem: 'Produto sem descrição.',
      });
    }

    if (!prod.unidade) {
      pushIssue(issues, {
        type: 'alerta',
        bloco: '0',
        registro: '0190',
        chave_ref: prod.codigo || '',
        mensagem: 'Produto sem unidade.',
      });
    }

    if (!prod.ncm) {
      pushIssue(issues, {
        type: 'alerta',
        bloco: '0',
        registro: '0200',
        chave_ref: prod.codigo || '',
        mensagem: 'Produto sem NCM.',
      });
    }
  }

  for (const doc of documents) {
    if (!doc.numero) {
      pushIssue(issues, {
        type: 'erro',
        bloco: 'C',
        registro: 'C100',
        chave_ref: doc.chave || '',
        mensagem: 'Documento sem número.',
      });
    }

    if (!doc.data_emissao) {
      pushIssue(issues, {
        type: 'erro',
        bloco: 'C',
        registro: 'C100',
        chave_ref: doc.numero || '',
        mensagem: 'Documento sem data de emissão.',
      });
    }

    if (!doc.participante_codigo) {
      pushIssue(issues, {
        type: 'alerta',
        bloco: 'C',
        registro: 'C100',
        chave_ref: doc.numero || '',
        mensagem: 'Documento sem participante vinculado.',
      });
    }

    const items = Array.isArray(doc.items) ? doc.items : [];
    if (!items.length) {
      pushIssue(issues, {
        type: 'alerta',
        bloco: 'C',
        registro: 'C170',
        chave_ref: doc.numero || '',
        mensagem: 'Documento sem itens.',
      });
    }

    for (const item of items) {
      if (!item.codigo_produto) {
        pushIssue(issues, {
          type: 'erro',
          bloco: 'C',
          registro: 'C170',
          chave_ref: doc.numero || '',
          mensagem: 'Item sem código do produto.',
        });
      }

      if (!item.cfop) {
        pushIssue(issues, {
          type: 'alerta',
          bloco: 'C',
          registro: 'C170',
          chave_ref: `${doc.numero || ''}/${item.codigo_produto || ''}`,
          mensagem: 'Item sem CFOP.',
        });
      }

      if (!item.cst_icms && !item.csosn) {
        pushIssue(issues, {
          type: 'alerta',
          bloco: 'C',
          registro: 'C170',
          chave_ref: `${doc.numero || ''}/${item.codigo_produto || ''}`,
          mensagem: 'Item sem CST ICMS / CSOSN.',
        });
      }
    }
  }

  const totalErrors = issues.filter(i => i.type === 'erro').length;
  const totalWarnings = issues.filter(i => i.type === 'alerta').length;

  return {
    ok: totalErrors === 0,
    totalErrors,
    totalWarnings,
    issues,
  };
}   