// services/nfeEndpoints.js
export const NFE_ENDPOINTS = {
  // -------- PRODUÇÃO --------
  prod: {
    MG: {
      StatusServico: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
      Autorizacao:   'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
      RetAutoriz:    'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
      RecepcaoEvento:'https://nfe.fazenda.mg.gov.br/nfe2/services/RecepcaoEvento4',
      ConsultaProt:  'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
      Inutilizacao:  'https://nfe.fazenda.mg.gov.br/nfe2/services/NfeInutilizacao4',
      CadConsulta:   'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
    },
    // UFs atendidas pelo SVRS permaneceriam aqui, apontando para nfe.svrs.rs.gov.br
  },
  // -------- HOMOLOGAÇÃO --------
  hom: {
    MG: {
      StatusServico: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
      Autorizacao:   'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
      RetAutoriz:    'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
      RecepcaoEvento:'https://hnfe.fazenda.mg.gov.br/nfe2/services/RecepcaoEvento4',
      ConsultaProt:  'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
      Inutilizacao:  'https://hnfe.fazenda.mg.gov.br/nfe2/services/NfeInutilizacao4',
      CadConsulta:   'https://hnfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
    },
  },
};

export function resolveWs(uf, env, servico){
  const keyEnv = env === '1' ? 'prod' : 'hom';
  const table = NFE_ENDPOINTS[keyEnv] || {};
  const ufTable = table[uf];
  if (!ufTable || !ufTable[servico]) {
    throw new Error(`Endpoint não mapeado: ${servico} ${uf} env=${keyEnv}`);
  }
  return ufTable[servico];
}
