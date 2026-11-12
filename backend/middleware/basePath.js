// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/middleware/basePath.js                                      ║
// ║ Roda o app debaixo de um caminho (ex.: /logistica-demo)             ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// APP_BASE_PATH=/logistica-demo  → o app atende em https://erp.consart.com.br/logistica-demo
// Vazio → nada muda (o app atende na raiz, como sempre).
//
// O ERP encaminha para cá:
//   • tudo que começa com /logistica-demo
//   • e o que vem de uma página /logistica-demo (Referer) — fetch('/api/...'), imagens etc.
//
// Aqui:
//   1. tira o prefixo da URL antes das rotas (as rotas continuam iguais);
//   2. página aberta sem prefixo → redireciona para a mesma página com prefixo;
//   3. res.redirect('/x') → /logistica-demo/x;
//   4. HTML, CSS e JS servidos: caminhos absolutos ("/public/...") ganham o prefixo
//      (src/href/action, url(/...) e import '/...').
//   5. HTML: injeta no <head> um script que separa o login deste sistema no navegador.
//      Os 4 sistemas ficam no mesmo domínio e usavam as mesmas chaves (token,
//      auth_token, ...): o token de um sistema ia para o outro ("invalid signature").
//      Com o prefixo (ex.: "prodnex:token") cada sistema guarda o seu login.

function normalizeBase(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

export const APP_BASE_PATH = normalizeBase(process.env.APP_BASE_PATH);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "/x" → "/base/x"; "//host", "/base/..." e caminhos relativos ficam como estão
function withBase(base, url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return url;
  if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) return url;
  return `${base}${url}`;
}

// Chaves de login/usuário/menu que passam a ter o prefixo do sistema.
const SCOPED_STORAGE_KEYS = [
  "token", "access_token", "auth_token", "authToken", "jwt", "token_expires_at",
  "auth_user", "user", "usuario", "usuario_nome", "usuario_acesso", "consart:menu-config",
];

function storageScopeScript(base) {
  const prefix = `${base.slice(1)}:`;
  return `<script>(function(){if(window.__storageScope)return;window.__storageScope=${JSON.stringify(prefix)};`
    + `var P=${JSON.stringify(prefix)},K=${JSON.stringify(SCOPED_STORAGE_KEYS)},S=Storage.prototype,`
    + `g=S.getItem,s=S.setItem,r=S.removeItem;function m(k){k=String(k);return K.indexOf(k)>=0?P+k:k}`
    + `S.getItem=function(k){return g.call(this,m(k))};S.setItem=function(k,v){return s.call(this,m(k),v)};`
    + `S.removeItem=function(k){return r.call(this,m(k))};})();</script>`;
}

function rewriteBody(base, type, body) {
  // (?!\/) evita "//cdn..."; (?!base) evita prefixar duas vezes
  const notBase = `(?!\\/)(?!${escapeRegex(base.slice(1))}(?:[/?"'\`]|$))`;

  if (type === "html") {
    // Primeiro script da página: tem que rodar antes de qualquer leitura do token.
    body = body.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}${storageScopeScript(base)}`);
    body = body.replace(
      new RegExp(`(\\s(?:src|href|action|poster|data-src)\\s*=\\s*["'])\\/${notBase}`, "gi"),
      `$1${base}/`
    );
  }
  if (type === "html" || type === "css") {
    body = body.replace(new RegExp(`(url\\(\\s*["']?)\\/${notBase}`, "gi"), `$1${base}/`);
  }
  if (type === "html" || type === "js") {
    // import x from '/public/...'; import '/public/...'; import('/public/...')
    body = body.replace(
      new RegExp(`(\\b(?:from|import)\\s*\\(?\\s*["'\`])\\/${notBase}`, "g"),
      `$1${base}/`
    );
  }
  return body;
}

function bodyType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("text/html")) return "html";
  if (ct.includes("text/css")) return "css";
  if (ct.includes("javascript")) return "js";
  return "";
}

export function basePath(base = APP_BASE_PATH) {
  if (!base) return (_req, _res, next) => next();

  return (req, res, next) => {
    const url = req.url || "/";
    const hasBase = url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);

    if (hasBase) {
      const rest = url.slice(base.length);
      req.url = rest.startsWith("/") ? rest : `/${rest}`;
    } else if (
      req.method === "GET" &&
      String(req.get("sec-fetch-dest") || "").toLowerCase() === "document" &&
      String(req.get("sec-fetch-mode") || "").toLowerCase() === "navigate"
    ) {
      // location.href = '/home/home.html' → volta para debaixo do prefixo
      return res.redirect(302, withBase(base, url));
    }

    // res.redirect('/home/home.html') → /base/home/home.html
    const redirect = res.redirect.bind(res);
    res.redirect = (...args) => {
      const i = args.length > 1 ? args.length - 1 : 0;
      args[i] = withBase(base, args[i]);
      return redirect(...args);
    };

    if (req.method !== "GET") return next();

    // Reescreve HTML/CSS/JS antes de enviar (o express.static manda em stream)
    const chunks = [];
    let type = null;
    const write = res.write.bind(res);
    const end = res.end.bind(res);

    const decide = () => {
      if (type === null) type = res.statusCode === 200 ? bodyType(res.getHeader("content-type")) : "";
      return type;
    };

    res.write = (chunk, encoding, cb) => {
      if (!decide()) return write(chunk, encoding, cb);
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8"));
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    };

    res.end = (chunk, encoding, cb) => {
      if (!decide()) return end(chunk, encoding, cb);
      if (typeof chunk === "function") { cb = chunk; chunk = null; }
      if (typeof encoding === "function") { cb = encoding; encoding = undefined; }
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || "utf8"));

      const out = Buffer.from(rewriteBody(base, type, Buffer.concat(chunks).toString("utf8")), "utf8");
      if (!res.headersSent) {
        res.removeHeader("etag");
        res.setHeader("content-length", out.length);
      }
      return end(req.method === "HEAD" ? undefined : out, cb);
    };

    next();
  };
}

export default basePath;
