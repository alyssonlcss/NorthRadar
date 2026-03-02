/**
 * Route Registry
 *
 * Registra todas as rotas da aplicação num único local.
 * Rotas simples (health, cache) ficam inline.
 * Rotas complexas (dashboard) são delegadas ao módulo DashboardRouter.
 */
const createDashboardRouter = require('../modules/dashboard/DashboardRouter');
const config = require('../config');

/**
 * Cooldown por usuário+filtro para o endpoint de deslocamentos.
 *
 * Estrutura: Map<userKey, Map<filterKey, lastFetchTimestamp>>
 *
 * - userKey  → IP do cliente (req.ip)
 * - filterKey → chave do filtro (ex.: 'TODOS' | 'ATLANTICO' | 'DECEN' | 'DNORT')
 * - lastFetchTimestamp → Date.now() da última busca que acionou o Spotfire
 */
const DESLOCAMENTO_USER_COOLDOWN_MS = config.spotfire.cooldownMs; // configurável via DESLOCAMENTO_COOLDOWN_MINUTES no .env
const _deslocamentoCooldown = new Map();

function _getUserCooldownMap(userKey) {
  if (!_deslocamentoCooldown.has(userKey)) {
    _deslocamentoCooldown.set(userKey, new Map());
  }
  return _deslocamentoCooldown.get(userKey);
}

function _isUserFilterCoolingDown(userKey, filterKey) {
  const last = _getUserCooldownMap(userKey).get(filterKey);
  return last !== undefined && (Date.now() - last) < DESLOCAMENTO_USER_COOLDOWN_MS;
}

function _setUserFilterTimestamp(userKey, filterKey) {
  _getUserCooldownMap(userKey).set(filterKey, Date.now());
}

/**
 * @param {import('express').Application} app
 * @param {Object} deps
 * @param {import('../modules/incidences/IncidenceService')}    deps.incidenceService
 * @param {import('../modules/auth/AuthProvider')}              deps.authProvider
 * @param {import('../modules/deslocamentos/DeslocamentoService')} deps.deslocamentoService
 */
function registerRoutes(app, { incidenceService, authProvider, deslocamentoService }) {
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

  // ── API: deslocamentos (on-demand via Spotfire) ──
  // Importante: este endpoint DEVE acionar o Spotfire para aplicar os filtros
  // (Área=NORTE, Disponibilidade=Em Serviço, Base de acordo com o polo) sempre
  // que o dashboard trocar o filtro master.
  app.get('/api/dash/deslocamentos', async (req, res) => {
    try {
      const polosParam = (req.query.polos || '').toString();
      const parsedPolos = polosParam
        ? polosParam.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean)
        : [];
      const requestedPolos = parsedPolos.length ? parsedPolos : ['ATLANTICO', 'DECEN', 'DNORT'];

      const allowedPolos = new Set(deslocamentoService.getPolos());
      const invalid = requestedPolos.filter((p) => !allowedPolos.has(p));
      if (invalid.length) {
        return res.status(400).json({
          success: false,
          message: `Polo(s) inválido(s): ${invalid.join(', ')}. Válidos: ${[...allowedPolos].join(', ')}`,
        });
      }

      // ── Cooldown por usuário+filtro ──
      // Cada IP só pode acionar uma nova busca no Spotfire para o mesmo filtro
      // a cada DESLOCAMENTO_USER_COOLDOWN_MS (10 min). Outros usuários não são afetados.
      const userKey = req.ip || 'unknown';
      const filterKey = requestedPolos.length > 1 ? 'TODOS' : requestedPolos[0];

      if (_isUserFilterCoolingDown(userKey, filterKey)) {
        const lastTs = _getUserCooldownMap(userKey).get(filterKey);
        const remainingMs = DESLOCAMENTO_USER_COOLDOWN_MS - (Date.now() - lastTs);
        const remainingSec = Math.ceil(remainingMs / 1000);

        // Retorna dados do cache existente sem acionar o Spotfire
        if (requestedPolos.length > 1) {
          const cached = deslocamentoService.getAllData();
          const allItems = Object.values(cached.polos || {}).flatMap((p) => p.items || []);
          return res.json({
            success: true,
            cached: true,
            cooldownRemainingSeconds: remainingSec,
            items: allItems,
            total: allItems.length,
            lastUpdated: cached.lastUpdated,
          });
        }

        const polo = requestedPolos[0];
        const cached = deslocamentoService.getDataByPolo(polo);
        return res.json({
          success: true,
          cached: true,
          cooldownRemainingSeconds: remainingSec,
          polo,
          ...cached,
        });
      }

      // Quando vier mais de um polo (ex.: TODOS = ATLANTICO,DECEN,DNORT),
      // o requisito é aplicar Base=(All) no Spotfire.
      if (requestedPolos.length > 1) {
        const data = await deslocamentoService.fetchTodos();
        _setUserFilterTimestamp(userKey, filterKey);
        return res.json({ success: true, ...data });
      }

      // Polo único: aplica Base específica (ATLÂNTICO/CENTRO-NORTE/NORTE)
      const polo = requestedPolos[0];
      const data = await deslocamentoService.fetchPolo(polo);
      _setUserFilterTimestamp(userKey, filterKey);
      return res.json({ success: true, polo, ...data });
    } catch (err) {
      // Log completo em dev para facilitar troubleshooting do Spotfire/Puppeteer
      // (mantém resposta minimalista para o frontend)
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[Route /api/dash/deslocamentos] erro:', err);
      }
      res.status(500).json({
        success: false,
        message: err.message,
        ...(process.env.NODE_ENV !== 'production' ? { stack: err?.stack } : {}),
      });
    }
  });

  // ── (Mantida para retrocompatibilidade local se necessário) ──
  app.get('/api/deslocamentos', (_req, res) => {
    try {
      const data = deslocamentoService.getAllData();
      // Agrega itens de todos os polos num array único
      const allItems = Object.values(data.polos || {}).flatMap((p) => p.items || []);
      res.json({
        success: true,
        items: allItems,
        total: allItems.length,
        polos: data.polos,
        lastUpdated: data.lastUpdated,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── API: deslocamentos por polo ──
  app.get('/api/deslocamentos/:polo', (req, res) => {
    try {
      const polo = req.params.polo.toUpperCase();
      const data = deslocamentoService.getDataByPolo(polo);
      res.json({ success: true, polo, ...data });
    } catch (err) {
      const status = err.message.includes('desconhecido') ? 404 : 500;
      res.status(status).json({ success: false, message: err.message });
    }
  });

  // ── API: refresh manual de um polo ──
  app.post('/api/deslocamentos/:polo/refresh', async (req, res) => {
    try {
      const data = await deslocamentoService.fetchPolo(req.params.polo.toUpperCase());
      res.json({ success: true, polo: req.params.polo.toUpperCase(), ...data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── Dashboard (HTML + proxy Operview) ──
  app.use(createDashboardRouter(authProvider));
}

module.exports = registerRoutes;
