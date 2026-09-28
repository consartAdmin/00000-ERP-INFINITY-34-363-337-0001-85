// backend/services/apis/pollNfeStatus.js
import fetch from 'node-fetch';

const orderId = process.argv[2] || 4;
const base = 'http://localhost:8080';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const deadline = Date.now() + 2 * 60 * 1000; // 2 min
  while (Date.now() < deadline) {
    const r = await fetch(`${base}/api/orders/${orderId}/nfe`);
    const j = await r.json();
    if (j?.ok && j?.nfe?.status) {
      console.log('STATUS:', j.nfe.status);
      if (j.nfe.status === 'AUTORIZADA') {
        console.log('✅ Autorizada! Baixe DANFE/XML:');
        console.log(`  DANFE: ${base}/api/orders/${orderId}/nfe/danfe`);
        console.log(`  XML  : ${base}/api/orders/${orderId}/nfe/xml`);
        process.exit(0);
      }
      if (['REJEITADA','DENEGADA','CANCELADA'].includes(j.nfe.status)) {
        console.log('⚠️ Status final:', j.nfe.status);
        process.exit(2);
      }
    } else {
      console.log('Aguardando…');
    }
    await sleep(5000);
  }
  console.log('⏱️ Timeout aguardando autorização.');
  process.exit(1);
})();
