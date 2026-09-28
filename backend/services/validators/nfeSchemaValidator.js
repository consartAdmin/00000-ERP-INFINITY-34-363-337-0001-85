import validator from 'xsd-schema-validator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ajuste o caminho do XSD conforme sua versão de layout (ex.: 4.00)
const XSD_PATH = process.env.NFE_XSD_PATH || path.join(__dirname, '../../schemas/pl_009_V4_00/NFe/consSitNFe_v4.00.xsd');

export async function validateXml(xmlString) {
  return await new Promise((resolve, reject) => {
    validator.validateXML(xmlString, XSD_PATH, (err, result) => {
      if (err) return reject(err);
      resolve(result.valid);
    });
  });
}
