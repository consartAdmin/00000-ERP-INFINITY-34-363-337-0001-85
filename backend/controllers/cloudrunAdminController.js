// ╔══════════════════════════════════════════════════════════════╗
// ║ cloudrunAdminController.js — Controller                      ║
// ║ CONSART ERP | Backend (ESM)                                  ║
// ╚══════════════════════════════════════════════════════════════╝

import {
  turnOnCloudRun,
  turnOffCloudRun,
  getCloudRunAdminConfig
} from '../services/cloudrunAdminService.js';

export async function handleTurnOn(req, res) {
  try {
    const result = await turnOnCloudRun();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      action: 'on',
      error: error.message
    });
  }
}

export async function handleTurnOff(req, res) {
  try {
    const result = await turnOffCloudRun();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      action: 'off',
      error: error.message
    });
  }
}

export async function handleCloudRunStatus(_req, res) {
  try {
    const cfg = await getCloudRunAdminConfig();
    return res.json({
      ok: true,
      config: cfg
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}