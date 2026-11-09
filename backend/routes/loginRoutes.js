// ╔══════════════════════════════════════════════════════════════════╗
// ║ loginRoutes.js — Rota de autenticação JWT (/api/login)           ║
// ║ Padrão ESM (import/export)                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

import { Router } from "express";
import { login, refreshSession } from "../controllers/loginController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

// 🎯 POST /api/login
router.post("/login", async (req, res) => {
  console.log("\n[LOGIN ROUTE] 🔐 POST /api/login");
  try {
    await login(req, res);
  } catch (err) {
    console.error("[LOGIN ROUTE] 💥 Erro inesperado:", err);
    res.status(500).json({
      erro: "Erro inesperado ao processar o login.",
      detalhe: err.message,
    });
  }
});

// 🔄 POST /api/session/refresh — renova o token enquanto o usuário usa o sistema
router.post("/session/refresh", requireAuth, refreshSession);

export default router;
