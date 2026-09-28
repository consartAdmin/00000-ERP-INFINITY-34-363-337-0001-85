// backend/services/apis/getNfeXml.js
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config({ path: 'backend/.env' });

const id = process.argv[2]; // passe o ID/CHAVE no argv
if (!id) {
  console.error('Uso: node backend/services/apis/getNfeXml.js <idOuChave>');
  process.exit(1);
}

const baseURL = process.env.PLUGNOTAS_BASE_URL || 'https://api.plugnotas.com.br';
const key = process.env.PLUGNOTAS_API_KEY;

(async () => {
  try {
    const res = await axios.get(`${baseURL}/nfe/${encodeURIComponent(id)}/xml`, {
      headers: { 'x-api-key': key },
      responseType: 'text',
    });
    console.log(res.data); // XML na stdout — copie e valide
  } catch (e) {
    console.error('Falha ao obter XML:', e.response?.status, e.response?.data || e.message);
  }
})();
