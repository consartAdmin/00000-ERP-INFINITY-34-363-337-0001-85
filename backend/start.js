// Ponto de entrada do contêiner (Dockerfile: node start.js).
//
// Sobe o Infinity (server.js) e, se estiverem na imagem, os outros projetos
// em apps/<nome> (copiados pelo deploy.ps1 a partir de backend-logistics/,
// backend-prodnex/ e backend-consart/). Cada projeto roda em processo próprio,
// numa porta interna, com o próprio banco; o Infinity encaminha
// /logistica-demo, /prodnex e /consart para eles (middleware/logisticaDemoProxy.js).
//
// Variáveis de cada projeto: as mesmas do Infinity, trocando as que vêm com
// prefixo (ex.: CONSART__DB_NAME=consart vira DB_NAME=consart só no CONSART).
// <PREFIXO>__UNSET lista as chaves do Infinity que o projeto não usa.
// Projeto sem <PREFIXO>__DB_NAME não sobe (nunca roda no banco do Infinity):
// nesse caso o caminho continua indo para a URL antiga (LOGISTICA_DEMO_URL etc.).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export const PROJETOS = [
  { nome: "logistics", prefixo: "LOGISTICS", basePath: "/logistica-demo", porta: 8081, urlVar: "LOGISTICA_DEMO_URL" },
  { nome: "prodnex",   prefixo: "PRODNEX",   basePath: "/prodnex",        porta: 8082, urlVar: "PRODNEX_URL" },
  { nome: "consart",   prefixo: "CONSART",   basePath: "/consart",        porta: 8083, urlVar: "CONSART_URL" },
];

const PREFIXOS = PROJETOS.map(p => `${p.prefixo}__`);
const isPrefixada = (k) => PREFIXOS.some(p => k.startsWith(p));

// Variáveis do Infinity sem as de outros projetos
function envBase() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!isPrefixada(k)) env[k] = v;
  }
  return env;
}

export function envDoProjeto(p, origem = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(origem)) {
    if (!isPrefixada(k)) env[k] = v;
  }
  const unset = String(origem[`${p.prefixo}__UNSET`] || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  for (const k of unset) delete env[k];

  const pre = `${p.prefixo}__`;
  for (const [k, v] of Object.entries(origem)) {
    if (k.startsWith(pre) && k !== `${pre}UNSET`) env[k.slice(pre.length)] = v;
  }

  for (const q of PROJETOS) delete env[q.urlVar];
  env.PORT = String(p.porta);
  env.APP_BASE_PATH = p.basePath;
  // 4 processos no mesmo contêiner: limita o heap dos projetos extras
  // (<PREFIXO>__NODE_OPTIONS troca esse limite)
  if (!origem[`${pre}NODE_OPTIONS`]) env.NODE_OPTIONS = "--max-old-space-size=384";
  return env;
}

const filhos = new Map();
let encerrando = false;

function comPrefixo(stream, out, tag) {
  let resto = "";
  stream.on("data", (chunk) => {
    const linhas = (resto + chunk.toString()).split("\n");
    resto = linhas.pop();
    for (const l of linhas) out.write(`${tag} ${l}\n`);
  });
  stream.on("end", () => { if (resto) out.write(`${tag} ${resto}\n`); });
}

function iniciar(nome, cwd, env, { principal = false, tentativa = 0 } = {}) {
  const tag = `[${nome}]`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env,
    stdio: principal ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (!principal) {
    comPrefixo(child.stdout, process.stdout, tag);
    comPrefixo(child.stderr, process.stderr, tag);
  }
  filhos.set(nome, child);
  const inicio = Date.now();

  child.on("exit", (code, signal) => {
    filhos.delete(nome);
    if (encerrando) {
      if (filhos.size === 0) process.exit(0);
      return;
    }
    if (principal) {
      // Sem o Infinity não há o que servir: o Cloud Run sobe outra instância
      console.error(`${tag} encerrou (code=${code}, signal=${signal}). Encerrando o contêiner.`);
      encerrar("INFINITY_EXIT", code || 1);
      return;
    }
    // Projeto extra caiu: reinicia sem derrubar os outros
    const n = Date.now() - inicio > 60000 ? 0 : tentativa + 1;
    const espera = Math.min(60000, 2000 * 2 ** Math.min(n, 5));
    console.error(`${tag} encerrou (code=${code}, signal=${signal}). Reiniciando em ${espera / 1000}s.`);
    setTimeout(() => {
      if (!encerrando) iniciar(nome, cwd, env, { tentativa: n });
    }, espera);
  });
}

function encerrar(sig, code = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const child of filhos.values()) child.kill(sig === "INFINITY_EXIT" ? "SIGTERM" : sig);
  // Margem para os servidores fecharem; o Cloud Run dá 10s após o SIGTERM
  setTimeout(() => process.exit(code), 9000).unref();
  if (filhos.size === 0) process.exit(code);
}

function main() {
  const infinityEnv = envBase();

  for (const p of PROJETOS) {
    const dir = path.join(ROOT, "apps", p.nome);
    if (!fs.existsSync(path.join(dir, "server.js"))) continue;
    if (!process.env[`${p.prefixo}__DB_NAME`]) {
      console.warn(`[start] ${p.nome}: ${p.prefixo}__DB_NAME não definido; projeto não iniciado (${p.basePath} segue para ${process.env[p.urlVar] || "lugar nenhum"}).`);
      continue;
    }
    infinityEnv[p.urlVar] = `http://127.0.0.1:${p.porta}`;
    console.log(`[start] ${p.nome}: ${p.basePath} → porta ${p.porta}`);
    iniciar(p.nome, dir, envDoProjeto(p));
  }

  iniciar("infinity", ROOT, infinityEnv, { principal: true });

  process.on("SIGTERM", () => encerrar("SIGTERM"));
  process.on("SIGINT", () => encerrar("SIGINT"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
