// backend/services/downloadCaixaAnexos.js
import { getFile, createReadStream, getSignedURL } from './gcs.js';

/**
 * Baixar anexo como stream direto (passa pelo backend)
 */
export async function streamDownload(res, gcsPath, filename) {
  if (!gcsPath) throw new Error('gcsPath obrigatório');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename || gcsPath.split('/').pop()}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

  return new Promise((resolve, reject) => {
    const stream = createReadStream(gcsPath);
    stream.on('error', (err) => {
      reject(err);
    });
    stream.on('end', () => resolve());
    stream.pipe(res);
  });
}

/**
 * Gerar URL assinada (recomendado, mais leve)
 */
export async function signedUrlDownload(gcsPath, expiresMinutes = 15) {
  if (!gcsPath) throw new Error('gcsPath obrigatório');
  return await getSignedURL(gcsPath, { action: 'read', expiresMinutes });
}

/**
 * Checar se um arquivo existe
 */
export async function existsAnexo(gcsPath) {
  const [exists] = await getFile(gcsPath).exists();
  return exists;
}
