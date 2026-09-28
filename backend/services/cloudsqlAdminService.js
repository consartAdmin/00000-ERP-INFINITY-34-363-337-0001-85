// ╔══════════════════════════════════════════════════════════════╗
// ║ cloudsqlAdminService.js — Controle Cloud SQL ON/OFF          ║
// ║ CONSART ERP | Backend ESM                                    ║
// ╚══════════════════════════════════════════════════════════════╝

import { google } from 'googleapis';

const PROJECT_ID =
  process.env.DEPLOY_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  'valued-torch-463412-r7';

const INSTANCE_ID =
  process.env.CLOUDSQL_INSTANCE_ID ||
  process.env.DEPLOY_SQL_INSTANCE_ID ||
  'consart-postgres'; // ✅ UPDATED

async function patchActivationPolicy(policy) {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const authClient = await auth.getClient();

  const sqladmin = google.sqladmin({
    version: 'v1beta4',
    auth: authClient,
  });

  const result = await sqladmin.instances.patch({
    project: PROJECT_ID,
    instance: INSTANCE_ID,
    requestBody: {
      settings: {
        activationPolicy: policy,
      },
    },
  });

  return result.data;
}

export async function turnOnCloudSQL() {
  return patchActivationPolicy('ALWAYS');
}

export async function turnOffCloudSQL() {
  return patchActivationPolicy('NEVER');
}