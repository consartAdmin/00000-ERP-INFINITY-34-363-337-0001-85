// ╔══════════════════════════════════════════════════════════════╗
// ║ cloudrunAdminService.js — Serviço Cloud Run Scaling         ║
// ║ CONSART ERP | Backend (ESM)                                 ║
// ║ - Liga (min-instances=1) via Cloud Run Admin API            ║
// ║ - Desliga (min-instances=0) via Cloud Run Admin API         ║
// ╚══════════════════════════════════════════════════════════════╝

import { GoogleAuth } from 'google-auth-library';

const PROJECT =
  process.env.DEPLOY_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  '';

const REGION =
  process.env.DEPLOY_REGION ||
  process.env.CLOUD_RUN_REGION ||
  process.env.GCP_REGION ||
  'us-central1';

const SERVICE =
  process.env.DEPLOY_SERVICE ||
  process.env.K_SERVICE ||
  '';

const CLOUD_RUN_API_BASE = 'https://run.googleapis.com/v2';
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

function assertRequiredEnv() {
  if (!PROJECT || !REGION || !SERVICE) {
    throw new Error(
      `Cloud Run admin misconfigured. PROJECT='${PROJECT || ''}', REGION='${REGION || ''}', SERVICE='${SERVICE || ''}'.`
    );
  }
}

function buildServiceName() {
  return `projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`;
}

function buildPatchUrl(minInstances) {
  const name = buildServiceName();
  const url = new URL(`${CLOUD_RUN_API_BASE}/${name}`);
  url.searchParams.set('update_mask', 'scaling.minInstanceCount');
  url.searchParams.set('validateOnly', 'false');
  return url.toString();
}

async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === 'string'
      ? tokenResponse
      : tokenResponse?.token || '';

  if (!token) {
    throw new Error('Não foi possível obter access token do Google.');
  }

  return token;
}

async function patchMinInstances(minInstances) {
  assertRequiredEnv();

  if (!Number.isInteger(minInstances) || minInstances < 0) {
    throw new Error(`minInstances inválido: ${minInstances}`);
  }

  const accessToken = await getAccessToken();
  const url = buildPatchUrl(minInstances);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      scaling: {
        minInstanceCount: minInstances
      }
    })
  });

  const raw = await response.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    throw new Error(
      `Falha ao atualizar Cloud Run (${response.status} ${response.statusText}) :: ${raw}`
    );
  }

  return {
    ok: true,
    project: PROJECT,
    region: REGION,
    service: SERVICE,
    minInstances,
    operation: data
  };
}

export async function turnOnCloudRun() {
  return patchMinInstances(1);
}

export async function turnOffCloudRun() {
  return patchMinInstances(0);
}

export async function getCloudRunAdminConfig() {
  return {
    project: PROJECT,
    region: REGION,
    service: SERVICE,
    serviceName: PROJECT && REGION && SERVICE ? buildServiceName() : null
  };
}