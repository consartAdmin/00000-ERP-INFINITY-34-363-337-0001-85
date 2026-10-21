// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/middleware/logisticaDemoProxy.js                            ║
// ║ erp.consart.com.br/logistica-demo → serviço consart-logistics-demo  ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// LOGISTICA_DEMO_URL=https://consart-logistics-demo-....run.app
// PRODNEX_URL=https://prodnex-....run.app  → /prodnex (mesmo esquema)
// CONSART_URL=https://<serviço consart>....run.app  → /consart
// Vazio → desligado (o ERP segue igual).
//
// Encaminha para o app de logística:
//   • tudo que começa com /logistica-demo
//   • e o que vem de uma página /logistica-demo (Referer), porque as telas
//     usam caminhos absolutos (fetch('/api/...'), '/public/...').
// O corpo segue em stream, por isso este middleware fica antes do express.json.

import http from "node:http";
import https from "node:https";

// Cabeçalhos hop-by-hop não passam adiante
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

function hasPrefix(p, PREFIX) {
  return p === PREFIX || p.startsWith(`${PREFIX}/`) || p.startsWith(`${PREFIX}?`);
}

function refererHasPrefix(req, PREFIX) {
  const ref = req.get("referer");
  if (!ref) return false;
  try {
    const u = new URL(ref);
    return u.host === req.get("host") && hasPrefix(u.pathname, PREFIX);
  } catch {
    return false;
  }
}

export function logisticaDemoProxy(target = process.env.LOGISTICA_DEMO_URL, PREFIX = "/logistica-demo") {
  const base = String(target || "").trim().replace(/\/+$/, "");
  if (!base) return (_req, _res, next) => next();

  const targetUrl = new URL(base);
  const client = targetUrl.protocol === "https:" ? https : http;
  console.log(`[${PREFIX.slice(1)}] ${PREFIX} → ${targetUrl.origin}`);

  return (req, res, next) => {
    const url = req.originalUrl || req.url || "/";
    if (!hasPrefix(url, PREFIX) && !refererHasPrefix(req, PREFIX)) return next();

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    }
    headers.host = targetUrl.host;
    headers["x-forwarded-host"] = req.get("host") || "";
    headers["x-forwarded-proto"] = req.protocol;

    const upstream = client.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || undefined,
        method: req.method,
        path: url,
        headers,
      },
      (up) => {
        const out = {};
        for (const [k, v] of Object.entries(up.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
        }
        // Redirect absoluto para o host do Cloud Run volta para o domínio do ERP
        if (out.location && String(out.location).startsWith(targetUrl.origin)) {
          out.location = String(out.location).slice(targetUrl.origin.length) || "/";
        }
        res.writeHead(up.statusCode || 502, out);
        up.pipe(res);
      }
    );

    upstream.setTimeout(300000, () => upstream.destroy(new Error("timeout")));
    upstream.on("error", (err) => {
      console.error(`[${PREFIX.slice(1)}] erro no encaminhamento:`, err.message);
      if (!res.headersSent) res.status(502).send(`${PREFIX.slice(1)} indisponível.`);
      else res.destroy();
    });

    req.pipe(upstream);
  };
}

export default logisticaDemoProxy;
