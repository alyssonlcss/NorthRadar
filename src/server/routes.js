/**
 * Route Registry
 *
 * Registra todas as rotas da aplicação num único local.
 * Rotas simples (health, cache) ficam inline.
 * Rotas complexas (dashboard) são delegadas ao módulo DashboardRouter.
 */
const createDashboardRouter = require('../modules/dashboard/DashboardRouter');

/**
 * @param {import('express').Application} app
 * @param {Object} deps
 * @param {import('../modules/incidences/IncidenceService')} deps.incidenceService
 * @param {import('../modules/auth/AuthProvider')}           deps.authProvider
 */
function registerRoutes(app, { incidenceService, authProvider }) {
  // ── API: cache de incidências ──
  app.get('/api/incidences', (_req, res) => {
    const data = incidenceService.getData();
    res.json({
      success: true,
      lastUpdated: data.lastUpdated,
      total: data.incidences.total,
      items: data.incidences.items,
    });
  });

  // ── API: health check ──
  app.get('/api/health', (_req, res) => {
    const data = incidenceService.getData();
    res.json({
      status: 'ok',
      lastUpdated: data.lastUpdated,
      uptime: process.uptime(),
    });
  });

  // ── Dashboard (HTML + proxy Operview) ──
  app.use(createDashboardRouter(authProvider));
}

module.exports = registerRoutes;
