// ╔════════════════════════════════════════════════════════════════════╗
// ║ contractsConsart.clauses.js — Cláusulas padrão e campos            ║
// ║ automáticos dos Contratos de Serviços (CONSART ERP)                ║
// ║ • DEFAULT_CLAUSES: modelo que entra em todo contrato novo; o       ║
// ║   usuário edita, inclui ou remove cláusulas em cada contrato.      ║
// ║ • {CAMPO} no texto é trocado pelo dado do contrato no PDF.         ║
// ╚════════════════════════════════════════════════════════════════════╝

export const PLACEHOLDERS = Object.freeze([
  { key: 'CONTRATANTE', label: 'Razão social do cliente' },
  { key: 'CONTRATANTE_DOC', label: 'CNPJ/CPF do cliente' },
  { key: 'CONTRATADA', label: 'Razão social da Consart' },
  { key: 'CONTRATADA_DOC', label: 'CNPJ da Consart' },
  { key: 'VALOR', label: 'Valor total (R$)' },
  { key: 'VALOR_EXTENSO', label: 'Valor total por extenso' },
  { key: 'COBRANCA', label: 'Tipo de cobrança (mensal, valor único...)' },
  { key: 'FORMA_PAGAMENTO', label: 'Forma de pagamento' },
  { key: 'CONDICAO_PAGAMENTO', label: 'Condição de pagamento' },
  { key: 'DIA_VENCIMENTO', label: 'Dia de vencimento' },
  { key: 'INICIO', label: 'Data de início' },
  { key: 'FIM', label: 'Data de término' },
  { key: 'VIGENCIA', label: 'Vigência (ex.: 12 meses)' },
  { key: 'INDICE_REAJUSTE', label: 'Índice de reajuste' },
  { key: 'LOCAL_EXECUCAO', label: 'Local de execução' },
  { key: 'PRAZO_EXECUCAO', label: 'Prazo de execução' },
  { key: 'FORO', label: 'Cidade do foro' },
]);

export const DEFAULT_CLAUSES = Object.freeze([
  {
    title: 'DO OBJETO',
    body: 'O presente contrato tem por objeto a prestação, pela CONTRATADA à CONTRATANTE, dos serviços '
      + 'descritos no quadro "Serviços contratados" deste instrumento, nas condições aqui estabelecidas.',
  },
  {
    title: 'DA VIGÊNCIA',
    body: 'Este contrato vigora por {VIGENCIA}, com início em {INICIO} e término em {FIM}, podendo ser '
      + 'prorrogado mediante termo aditivo assinado pelas partes.',
  },
  {
    title: 'DO VALOR E DA FORMA DE PAGAMENTO',
    body: 'Pelos serviços contratados, a CONTRATANTE pagará à CONTRATADA o valor de {VALOR} ({VALOR_EXTENSO}), '
      + '{COBRANCA}, por meio de {FORMA_PAGAMENTO}, com vencimento todo dia {DIA_VENCIMENTO}. '
      + 'Condição: {CONDICAO_PAGAMENTO}.\n'
      + 'Parágrafo único. O atraso no pagamento sujeita a CONTRATANTE a multa de 2% (dois por cento) e juros '
      + 'de mora de 1% (um por cento) ao mês, calculados pro rata die sobre o valor em atraso.',
  },
  {
    title: 'DO REAJUSTE',
    body: 'O valor deste contrato será reajustado a cada 12 (doze) meses, pela variação acumulada do índice '
      + '{INDICE_REAJUSTE} no período, ou por outro índice que venha a substituí-lo.',
  },
  {
    title: 'DAS OBRIGAÇÕES DA CONTRATADA',
    body: 'São obrigações da CONTRATADA: a) executar os serviços com zelo, qualidade técnica e dentro dos prazos '
      + 'acordados; b) manter a CONTRATANTE informada sobre o andamento dos trabalhos; c) disponibilizar '
      + 'profissionais qualificados para a execução dos serviços; d) responsabilizar-se pelos encargos '
      + 'trabalhistas, previdenciários e fiscais de seus colaboradores.',
  },
  {
    title: 'DAS OBRIGAÇÕES DA CONTRATANTE',
    body: 'São obrigações da CONTRATANTE: a) efetuar os pagamentos nas datas acordadas; b) fornecer as '
      + 'informações, documentos e acessos necessários à execução dos serviços; c) indicar um responsável '
      + 'para acompanhar a execução do contrato.',
  },
  {
    title: 'DA CONFIDENCIALIDADE',
    body: 'As partes se obrigam a manter sigilo sobre todas as informações a que tiverem acesso em razão deste '
      + 'contrato, durante a sua vigência e por 2 (dois) anos após o seu término, salvo autorização expressa '
      + 'da outra parte ou determinação legal.',
  },
  {
    title: 'DA PROTEÇÃO DE DADOS',
    body: 'As partes comprometem-se a tratar os dados pessoais envolvidos na execução deste contrato em '
      + 'conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados - LGPD), utilizando-os '
      + 'exclusivamente para as finalidades deste instrumento.',
  },
  {
    title: 'DA RESCISÃO',
    body: 'Este contrato poderá ser rescindido por qualquer das partes, sem ônus, mediante aviso prévio por '
      + 'escrito de 30 (trinta) dias. O descumprimento de qualquer cláusula autoriza a rescisão imediata pela '
      + 'parte prejudicada, sem prejuízo das perdas e danos. Os serviços já prestados até a data da rescisão '
      + 'serão devidos pela CONTRATANTE.',
  },
  {
    title: 'DA INEXISTÊNCIA DE VÍNCULO EMPREGATÍCIO',
    body: 'Este contrato não gera vínculo empregatício entre a CONTRATANTE e os profissionais da CONTRATADA, '
      + 'cabendo a esta a direção, a remuneração e todos os encargos de seus colaboradores.',
  },
  {
    title: 'DO FORO',
    body: 'Fica eleito o foro da comarca de {FORO} para dirimir quaisquer dúvidas oriundas deste contrato, '
      + 'com renúncia expressa a qualquer outro, por mais privilegiado que seja.',
  },
]);
