// ╔══════════════════════════════════════════════════════════════════════╗
// ║ dashboardAccess.js — Home dashboard access control                 ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

const API_BASE = '/api/users-dashboard-access';

/**
 * Indicadores que nasceram depois do "Análise de Vendas": enquanto o
 * usuário não tiver um registro gravado para eles, seguem a permissão do
 * pai. Depois de salvos na tela Acesso aos Dashboards, vale o que foi
 * marcado (inclusive desmarcado).
 */
export const DASHBOARD_INHERITS = Object.freeze({
  'sales-taxes': 'sales-analytics',
  'tax-assessment': 'sales-analytics',
  'stock-lots-expiry': 'sales-analytics',
  'stock-replenishment': 'sales-analytics',
});

/**
 * rows: [{ dashboardKey, canView }] → Set com as chaves liberadas,
 * já aplicando a herança de DASHBOARD_INHERITS.
 */
export function resolveDashboardAccess(rows = []) {
  const explicit = new Map();

  for (const item of Array.isArray(rows) ? rows : []) {
    const key = String(item?.dashboardKey ?? item?.dashboard_key ?? '').trim();
    if (key) explicit.set(key, (item?.canView ?? item?.can_view) === true);
  }

  const allowed = new Set(
    [...explicit].filter(([, canView]) => canView).map(([key]) => key)
  );

  for (const [child, parent] of Object.entries(DASHBOARD_INHERITS)) {
    if (!explicit.has(child) && explicit.get(parent) === true) {
      allowed.add(child);
    }
  }

  return allowed;
}

function getToken() {
  return (
    localStorage.getItem('token') ||
    sessionStorage.getItem('token') ||
    ''
  );
}

function authHeaders() {
  const token = getToken();

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
}

export async function getDashboardAccess(userId) {
  const parsedUserId = Number(userId);

  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    console.warn(
      '[dashboardAccess] Invalid user ID:',
      userId
    );

    return new Set();
  }

  try {
    const response = await fetch(
      `${API_BASE}/${encodeURIComponent(parsedUserId)}`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          ...authHeaders(),
        },
      }
    );

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
        `Dashboard access request failed with HTTP ${response.status}.`
      );
    }

    const dashboards = Array.isArray(data?.dashboards)
      ? data.dashboards
      : [];

    return resolveDashboardAccess(dashboards);
  } catch (error) {
    console.error(
      '[dashboardAccess] Failed to load permissions:',
      error
    );

    // Fail closed: no permission data = no dashboard access.
    return new Set();
  }
}

export function applyDashboardAccess(
  root,
  allowedDashboards
) {
  if (!root) {
    return;
  }

  const allowed =
    allowedDashboards instanceof Set
      ? allowedDashboards
      : new Set();

  root
    .querySelectorAll('.dash-card')
    .forEach((card) => {
      const dashboardKey =
        card.dataset.dashboardKey ||
        card.dataset.id ||
        '';

      card.hidden = !allowed.has(dashboardKey);
    });
}
