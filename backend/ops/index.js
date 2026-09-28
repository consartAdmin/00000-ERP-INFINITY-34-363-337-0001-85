// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ops/index.js — Scheduler Ops (Cloud Run)                             ║
// ║ - Endpoints: POST /sleep  | POST /wake                               ║
// ║ - Patches: Cloud Run min/max instances + Cloud SQL activationPolicy  ║
// ║ - Protect: X-OPS-KEY header                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import express from "express";
import { GoogleAuth } from "google-auth-library";

const app = express();
app.use(express.json({ limit: "256kb" }));

const {
  PROJECT_ID,
  REGION,
  TARGET_SERVICE,           // your main ERP Cloud Run service name
  SQL_INSTANCE,             // e.g. consart-postgres
  NIGHT_MIN_INSTANCES = "0",
  NIGHT_MAX_INSTANCES = "1", // max can't be 0; keep small
  DAY_MIN_INSTANCES = "1",
  DAY_MAX_INSTANCES = "3",
  OPS_KEY
} = process.env;

if (!PROJECT_ID || !REGION || !TARGET_SERVICE || !SQL_INSTANCE || !OPS_KEY) {
  console.error("Missing envs: PROJECT_ID, REGION, TARGET_SERVICE, SQL_INSTANCE, OPS_KEY");
  process.exit(1);
}

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

function mustAuth(req, res) {
  const k = req.header("x-ops-key");
  if (!k || k !== OPS_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
  return null;
}

async function authedFetch(url, { method = "GET", body, headers = {} } = {}) {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token.token || token}`,
      "Content-Type": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch {}
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${txt}`);
  }
  return json ?? txt;
}

// ---- Cloud Run (v2) patch scaling
async function patchCloudRunScaling(minInstanceCount, maxInstanceCount) {
  const name = `projects/${PROJECT_ID}/locations/${REGION}/services/${TARGET_SERVICE}`;
  const url =
    `https://run.googleapis.com/v2/${name}` +
    `?updateMask=scaling.minInstanceCount,scaling.maxInstanceCount`;

  return authedFetch(url, {
    method: "PATCH",
    body: { scaling: { minInstanceCount, maxInstanceCount } }
  });
}

// ---- Cloud SQL patch activationPolicy
async function patchCloudSqlActivationPolicy(policy) {
  const url = `https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT_ID}/instances/${SQL_INSTANCE}`;
  return authedFetch(url, {
    method: "PATCH",
    body: { settings: { activationPolicy: policy } }
  });
}

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/sleep", async (req, res) => {
  const deny = mustAuth(req, res); if (deny) return;

  try {
    const runResp = await patchCloudRunScaling(
      Number(NIGHT_MIN_INSTANCES),
      Number(NIGHT_MAX_INSTANCES)
    );

    const sqlResp = await patchCloudSqlActivationPolicy("NEVER");

    res.json({ ok: true, action: "sleep", cloudRun: runResp, cloudSql: sqlResp });
  } catch (e) {
    res.status(500).json({ ok: false, action: "sleep", error: String(e?.message || e) });
  }
});

app.post("/wake", async (req, res) => {
  const deny = mustAuth(req, res); if (deny) return;

  try {
    const sqlResp = await patchCloudSqlActivationPolicy("ALWAYS");

    const runResp = await patchCloudRunScaling(
      Number(DAY_MIN_INSTANCES),
      Number(DAY_MAX_INSTANCES)
    );

    res.json({ ok: true, action: "wake", cloudRun: runResp, cloudSql: sqlResp });
  } catch (e) {
    res.status(500).json({ ok: false, action: "wake", error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`ops listening on :${port}`));