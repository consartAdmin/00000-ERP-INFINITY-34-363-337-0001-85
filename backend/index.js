// ╔══════════════════════════════════════════════════════════════════════╗
// ║ index.js — Teste local da CONSART NF-e API                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import 'dotenv/config';
import { gerarPrevia } from './services/nfe55Service.js';
import { salvarBase64EmArquivo } from './utils/base64.js';

async function main() {
  const nfe = {
    ide: {
      cUF: '31',
      natOp: 'VENDA DE TESTE',
      mod: '55',
      serie: '1',
      nNF: '1',
      tpAmb: '2'
    },
    emit: {
      CNPJ: '34363337000185',
      xNome: 'BH3 DISTRIBUIDORA DE PRODUTOS DE LIMPEZA LTDA',
      enderEmit: {
        UF: 'MG',
        cMun: '3106200'
      },
      IE: '0037087150057'
    },
    dest: {
      CNPJ: '00000000000191',
      xNome: 'CLIENTE TESTE'
    },
    det: [
      {
        prod: {
          cProd: 'TESTE01',
          xProd: 'PRODUTO TESTE',
          CFOP: '5102',
          uCom: 'UN',
          qCom: '1',
          vUnCom: '10.00'
        }
      }
    ],
    total: {
      ICMSTot: {
        vNF: '10.00'
      }
    }
  };

  const previa = await gerarPrevia(nfe);

  console.log('Prévia OK:', previa.previaId);

  salvarBase64EmArquivo(
    previa.data.contentBase64,
    `./previa-${previa.previaId}.pdf`
  );

  console.log('PDF salvo com sucesso');
}

main().catch(err => {
  console.error('Erro:', err.response?.data || err.message);
});
