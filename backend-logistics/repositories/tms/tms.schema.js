/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: tms.schema.js                                                 ║
   ║ MODULE: Transporte (TMS)                                            ║
   ║ DESCRIPTION: roda o DDL idempotente de tms.schema.ddl.js (memoizado)   ║
   ║   Antes garante as tabelas de Entregas (drivers / vehicles /        ║
   ║   deliveryTrips), que são referenciadas pelas tabelas do TMS.       ║
   ║ CONSART LOGISTICS · PostgreSQL · ESM                                ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../config/db.js';
import { ensureDeliveryTables } from '../deliveryTrips/deliveryTrips.schema.js';
import { TMS_DDL } from './tms.schema.ddl.js';

let readyPromise = null;

export function ensureTmsTables() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureDeliveryTables();
      const client = await pool.connect();
      try {
        await client.query(`SELECT pg_advisory_lock(hashtext('tms_ddl')::bigint)`);
        await client.query(TMS_DDL);
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext('tms_ddl')::bigint)`).catch(() => {});
        client.release();
      }
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}
