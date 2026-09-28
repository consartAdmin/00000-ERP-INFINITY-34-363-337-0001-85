// ╔══════════════════════════════════════════════════════════════╗
// ║ utils/ibgeMaps.js – helpers de UF/Município p/ NF-e          ║
// ╚══════════════════════════════════════════════════════════════╝

// Tabela UF -> código IBGE (2 dígitos)
const UF_TO_COD = {
  AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23',
  DF: '53', ES: '32', GO: '52', MA: '21', MG: '31', MS: '50',
  MT: '51', PA: '15', PB: '25', PE: '26', PI: '22', PR: '41',
  RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42',
  SE: '28', SP: '35', TO: '17'
};

/**
 * Retorna o código IBGE da UF (string de 2 dígitos).
 * Aceita "mg", "MG", "  mg  ".
 */
export function codUfIBGE(uf) {
  const k = String(uf || '').trim().toUpperCase();
  return UF_TO_COD[k] || '';
}

/**
 * Normaliza/resolve o código IBGE do município (7 dígitos).
 * Aceita:
 *  - número/string já com 7 dígitos → retorna como está
 *  - objeto com { cMun } ou { codigo } ou { ibge } → extrai
 *  - fallback: retorna '' (deixe o chamador validar/lançar erro)
 */
export function codMunIBGE(input) {
  if (input == null) return '';
  // Já é número / string de dígitos
  const s = String(typeof input === 'object' ? (input.cMun ?? input.codigo ?? input.ibge ?? '') : input).trim();
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 7) return digits;
  // Se veio "3106200 - Barbacena/MG" (ou parecido), tenta pegar o prefixo
  const m = /^(\d{7})\b/.exec(s);
  if (m) return m[1];
  return '';
}

/**
 * (Opcional) Busca nome/UF de um código IBGE (stub: retorna null se não implementado).
 * Mantido para compatibilidade com os imports do projeto.
 */
export function getMunicipioByCodigo(cMun) {
  const code = codMunIBGE(cMun);
  if (!code) return null;
  // Aqui você pode plugar uma tabela local ou API própria se quiser.
  return null;
}

/**
 * (Opcional) Mapeia um objeto de endereço genérico para estrutura esperada no XML.
 * Mantido como utilidade, caso você use em outro ponto.
 */
export function mapAddressToEnderNFe(addr = {}) {
  return {
    xLgr: addr.xLgr || addr.logradouro || addr.nome_logradouro || '',
    nro:  addr.nro  || addr.numero || '',
    xCpl: addr.xCpl || addr.complemento || '',
    xBairro: addr.xBairro || addr.bairro || '',
    cMun: codMunIBGE(addr.cMun || addr.codigo_municipio || ''),
    xMun: addr.xMun || addr.municipio || addr.cidade || '',
    UF:   (addr.UF || addr.uf || '').toString().toUpperCase(),
    CEP:  (addr.CEP || addr.cep || '').toString(),
    cPais: '1058',
    xPais: 'BRASIL',
    fone:  (addr.fone || addr.telefone || '').toString()
  };
}

export default { codUfIBGE, codMunIBGE, getMunicipioByCodigo, mapAddressToEnderNFe };
