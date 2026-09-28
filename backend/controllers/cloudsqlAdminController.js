// ╔══════════════════════════════════════════════════════════════╗
// ║ cloudsqlAdminController.js                                  ║
// ╚══════════════════════════════════════════════════════════════╝

import { turnOnCloudSQL, turnOffCloudSQL } from '../services/cloudsqlAdminService.js';

export async function sqlOn(req, res) {
  try {
    await turnOnCloudSQL();
    res.json({ ok: true, message: 'Cloud SQL ON' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.toString() });
  }
}

export async function sqlOff(req, res) {
  try {
    await turnOffCloudSQL();
    res.json({ ok: true, message: 'Cloud SQL OFF' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.toString() });
  }
}