// ╔══════════════════════════════════════════════════════════════════════════════════╗
// ║ backend/services/nfeApiClient.js – Cliente HTTP para comunicação com a API NF-e  ║
// ╚══════════════════════════════════════════════════════════════════════════════════╝
import fetch from "node-fetch"; // ou global fetch se estiver habilitado no Node
import { URL } from "node:url";

const BASE = process.env.NFE_API_BASE_URL || "https://emissor-nfe-consart-55t54xedeq-uc.a.run.app";
const API_KEY    = process.env.NFE_API_KEY    || "";
const API_SECRET = process.env.NFE_API_SECRET || "";

function authHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "X-Api-Key":     API_KEY,
    "X-Api-Secret":  API_SECRET,
    ...extra,
  };
}

function urlJoin(...parts) {
  return new URL(parts.filter(Boolean).join("/"), BASE).toString();
}

async function http(method, path, body, extraHeaders) {
  const url = urlJoin(path);
  const init = {
    method,
    headers: authHeaders(extraHeaders),
    redirect: "follow",
  };
  if (body !== undefined) init.body = (typeof body === "string" ? body : JSON.stringify(body));

  const res = await fetch(url, init);
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, headers: res.headers, data, text, url };
}

export const nfeApiClient = {
  emitir:         (payload) => http("POST", "/nfe/emitir", payload),
  status:         (id)      => http("GET",  `/nfe/${encodeURIComponent(id)}`, undefined),
  danfe:          (id)      => http("GET",  `/nfe/${encodeURIComponent(id)}/danfe`, undefined,
                                         { Accept: "application/pdf" }),
  previewByPedido:(pedidoRef)=> http("GET",  `/nfe/preview/${encodeURIComponent(pedidoRef)}`),
  sequenciaPreview:(qs="")   => http("GET",  `/nfe/sequencia/preview${qs?`?${qs}`:""}`),
};

export default nfeApiClient;
