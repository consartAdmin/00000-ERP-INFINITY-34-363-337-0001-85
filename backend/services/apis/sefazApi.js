// ╔══════════════════════════════════════════════════════════════════════╗
// ║ sefazApi.js — Provedor interno de “dados SEFAZ” (mock local)        ║
// ║ CONSART ERP — NÃO chama nenhum serviço externo                      ║
// ║ Mantém a mesma interface: searchSefazByCnpj / searchSefazByIe       ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Remove tudo que não for dígito.
 */
function onlyDigits(v = '') {
  return String(v).replace(/\D+/g, '');
}

/**
 * 🔁 Mapeia o CNPJ para um “cadastro SEFAZ” mockado.
 * Aqui você pode ir adicionando outros CNPJs depois, se quiser.
 */
function getMockCadastroByCnpj(cnpjDigits) {
  // CNPJ da BH3: 34.363.337/0001-85
  if (cnpjDigits === '34363337000185') {
    return {
      // Documentos
      cnpj: '34363337000185',
      cpfCnpj: '34363337000185',

      // Nome / Fantasia
      nome: 'BH3 DISTRIBUIDORA DE PRODUTOS DE LIMPEZA LTDA',
      razao_social: 'BH3 DISTRIBUIDORA DE PRODUTOS DE LIMPEZA LTDA',
      fantasia: 'BH3 DISTRIBUIDORA',

      // 🔹 Inscrições  → AQUI VOCÊ AJUSTA PARA O VALOR REAL
      inscricao_estadual: 'INSCRICAO_ESTADUAL_AQUI', // ← coloque a IE correta da BH3
      inscricao_municipal: null, // se tiver, pode preencher também

      // Contato
      email: 'vendas@bh3distribuidora.com.br',
      telefone: '(31) 3566-0070',

      // Endereço
      cep: '30170012',
      logradouro: 'AVENIDA BIAS FORTES',
      numero: '784',
      complemento: null,
      bairro: 'LOURDES',
      municipio: 'BELO HORIZONTE',
      uf: 'MG'
    };
  }

  return null;
}

/**
 * 🔍 Consulta “SEFAZ” por CNPJ
 * Aqui NÃO existe chamada externa; apenas lookup local (mock).
 *
 * @param {Object} params
 * @param {string} params.cnpj - CNPJ informado (com ou sem máscara)
 * @param {string|null} params.uf - (ignorado por enquanto, mas mantido p/ futuro)
 */
async function searchSefazByCnpj({ cnpj, uf = null }) {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) {
    throw new Error('CNPJ inválido (14 dígitos obrigatórios).');
  }

  const cadastro = getMockCadastroByCnpj(digits);
  if (!cadastro) {
    // Mantém padrão de “erro de consulta”
    throw new Error('Cadastro não encontrado na base local (mock).');
  }

  // Mantém formato compatível com o que o controller espera: objeto “data”
  return cadastro;
}

/**
 * 🔍 (Opcional) Consulta por IE + UF — por enquanto só mocka erro.
 * Mantemos a função para não quebrar nada, mas ainda não há base local.
 */
async function searchSefazByIe({ uf, ie }) {
  throw new Error('Consulta por IE ainda não implementada na base local.');
}

// Export default no padrão que você já está usando.
export default {
  searchSefazByCnpj,
  searchSefazByIe
};
