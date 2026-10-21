// ╔══════════════════════════════════════════════════════════════════════╗
// ║ 2026-10-17 — Módulos de Transporte (TMS)                             ║
// ║ - Cria as 27 tabelas do TMS (repositories/tms/tms.schema.ddl.js)      ║
// ║ - Registra o menu "🚛 Transporte" (logo depois de 🚚 Logística)      ║
// ║ - Libera os itens novos para quem já acessa 🚚 Logística             ║
// ║ - O backend já faz tudo isto sozinho ao subir; este script é para    ║
// ║   rodar à mão, se preferir.                                          ║
// ║ - Aditivo e idempotente: pode ser executado mais de uma vez          ║
// ║                                                                      ║
// ║ Uso (na pasta backend):  node scripts/2026-10-17_tms_modules.mjs     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import '../config/loadEnv.js';
import pool from '../config/db.js';
import { ensureTmsTables, registerTmsMenu } from '../repositories/tms/tms.index.js';

try {
    await ensureTmsTables();
    console.log('Tabelas do TMS prontas.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { inserted, accessGranted } = await registerTmsMenu(client);
        await client.query('COMMIT');
        console.log(inserted.length
            ? `Menu: ${inserted.length} item(ns) criado(s) (IDs ${inserted.join(', ')}); ${accessGranted} acesso(s) liberado(s).`
            : 'Menu já estava registrado: nada mudou.');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    console.log('Pronto. Atualize a página (Ctrl+F5) para ver o menu 🚛 Transporte.');
} catch (error) {
    console.error('Erro:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
