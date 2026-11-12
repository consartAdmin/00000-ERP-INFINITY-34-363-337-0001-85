// ╔════════════════════════════════════════════════════════════════════╗
// ║ requirePdvAuth.js — Token do caixa (Consart Starter)                ║
// ║ O token é emitido em POST /api/pdv/auth/login (usuários pdv_logins) ║
// ╚════════════════════════════════════════════════════════════════════╝

import jwt from 'jsonwebtoken';

export const PDV_TOKEN_SCOPE = 'pdv-starter';
export const PDV_TOKEN_TTL = '14h';

export function signPdvToken(user, terminal) {
  return jwt.sign(
    {
      scope: PDV_TOKEN_SCOPE,
      pdv_user_id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      terminal,
    },
    process.env.JWT_SECRET,
    { expiresIn: PDV_TOKEN_TTL },
  );
}

export function requirePdvAuth(req, res, next) {
  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    return res.status(500).json({ success: false, error: 'AUTH_MISCONFIGURED', message: 'JWT_SECRET não configurado.' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  if (!token) return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Faça login no caixa.' });

  try {
    const payload = jwt.verify(token, secret);
    if (payload.scope !== PDV_TOKEN_SCOPE) throw new Error('scope');
    req.pdvUser = payload;
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Sessão do caixa expirada. Entre novamente.' });
  }
}
