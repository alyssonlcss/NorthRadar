/**
 * DashboardRouter
 *
 * Express Router que agrupa todas as rotas do dashboard:
 * páginas HTML, status, debug e proxy para Operview.
 */
const { Router } = require('express');
const path = require('path');
const config = require('../../config');
const Logger = require('../../shared/Logger');
const DashboardProxy = require('./DashboardProxy');

/**
 * Cria e retorna um Express Router com todas as rotas do dashboard.
 *
 * @param {import('../auth/AuthProvider')} authProvider
 * @returns {Router}
 */
function createDashboardRouter(authProvider) {
  const router = Router();
  const proxy = new DashboardProxy(authProvider);
  const logger = Logger.create('Dashboard');
  const publicPath = path.join(__dirname, '..', '..', 'public');

  // ── Páginas HTML ──

  router.get('/', (_req, res) => {
    res.sendFile(path.join(publicPath, 'dash.html'));
  });

  router.get('/dash', (_req, res) => {
    res.sendFile(path.join(publicPath, 'dash.html'));
  });

  // ── Status ──

  router.get('/api/dash/status', (req, res) => {
    const token = authProvider?.getToken();
    const hasToken = !!token;

    res.json({
      success: true,
      auth: {
        hasToken,
        tokenPreview: hasToken ? token.substring(0, 30) + '...' : null,
        isAuthenticated: authProvider?.isAuthenticated?.() || false,
      },
      config: {
        domainApi: config.operview.domainApi || '(NÃO CONFIGURADO)',
        port: req.socket.localPort,
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Debug ──

  router.get('/api/dash/debug', async (req, res) => {
    const result = { timestamp: new Date().toISOString(), tests: {} };
    const token = authProvider?.getToken();

    result.auth = {
      hasToken: !!token,
      tokenPreview: token ? token.substring(0, 40) + '...' : null,
    };
    result.config = {
      domainApi: config.operview.domainApi || '(NÃO CONFIGURADO)',
    };

    if (!token || !config.operview.domainApi) {
      return res.json(result);
    }

    const baseUrl = config.operview.domainApi;
    const polos = req.query.polos || 'ATLANTICO';
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const dataInicio = proxy.formatDate(threeDaysAgo) + ' 00:00:00';
    const dataFim = proxy.formatDate(now) + ' 23:59:59';

    // Teste 1: incidências
    try {
      const urlInc =
        `${baseUrl}/incidencias/consultar?colNumOrder=0&orderAsc=true&skip=0&take=5` +
        `&dataInicio=${encodeURIComponent(dataInicio)}` +
        `&dataFim=${encodeURIComponent(dataFim)}` +
        `&polos=${encodeURIComponent(polos)}` +
        `&estados=ACTIVO`;
      result.tests.incidencias = { url: urlInc };
      const rawInc = await proxy.get(urlInc, token);
      const keys = Object.keys(rawInc);
      result.tests.incidencias.responseKeys = keys;
      result.tests.incidencias.isArray = Array.isArray(rawInc);

      let items = [];
      if (Array.isArray(rawInc)) {
        items = rawInc;
        result.tests.incidencias.itemsSource = 'root (array)';
      } else {
        for (const k of keys) {
          if (Array.isArray(rawInc[k])) {
            items = rawInc[k];
            result.tests.incidencias.itemsSource = `rawInc.${k}`;
            break;
          }
        }
      }

      result.tests.incidencias.itemCount = items.length;
      result.tests.incidencias.total =
        rawInc.total ?? rawInc.totalCount ?? rawInc.recordsTotal ?? null;
      if (items.length > 0) {
        result.tests.incidencias.sampleItemKeys = Object.keys(items[0]);
        result.tests.incidencias.sampleItem = items[0];
      }
    } catch (err) {
      result.tests.incidencias = { error: err.message };
    }

    // Teste 2: equipes
    try {
      const urlEq =
        `${baseUrl}/dashboards/tempo-real-produtividade/equipe-em-turno` +
        `?polos=${encodeURIComponent(polos)}` +
        `&sucursais=&tipos=&niveisTensao=&alimentadores=&tiposEquipes=&setoresEquipes=`;
      result.tests.equipes = { url: urlEq };
      const rawEq = await proxy.get(urlEq, token);
      const keys = Object.keys(rawEq);
      result.tests.equipes.responseKeys = keys;
      result.tests.equipes.isArray = Array.isArray(rawEq);

      let items = [];
      if (Array.isArray(rawEq)) {
        items = rawEq;
        result.tests.equipes.itemsSource = 'root (array)';
      } else {
        for (const k of keys) {
          if (Array.isArray(rawEq[k])) {
            items = rawEq[k];
            result.tests.equipes.itemsSource = `rawEq.${k}`;
            break;
          }
        }
      }

      result.tests.equipes.itemCount = items.length;
      if (items.length > 0) {
        result.tests.equipes.sampleItemKeys = Object.keys(items[0]);
        result.tests.equipes.sampleItem = items[0];
      }
    } catch (err) {
      result.tests.equipes = { error: err.message };
    }

    res.json(result);
  });

  // ── Proxy: incidências ──

  router.get('/api/dash/incidencias', async (req, res) => {
    try {
      const token = authProvider?.getToken();
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Token não disponível. Aguarde a autenticação.',
          items: [],
        });
      }

      const baseUrl = config.operview.domainApi;
      if (!baseUrl) {
        return res.status(500).json({
          success: false,
          error: 'OPERVIEW_DOMAIN_API não configurado no .env',
          items: [],
        });
      }

      const polos = req.query.polos || 'ATLANTICO';
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const url =
        `${baseUrl}/incidencias/consultar?colNumOrder=0&orderAsc=true&skip=0&take=5000` +
        `&dataInicio=${encodeURIComponent(proxy.formatDate(weekAgo) + ' 00:00:00')}` +
        `&dataFim=${encodeURIComponent(proxy.formatDate(now) + ' 23:59:59')}` +
        `&polos=${encodeURIComponent(polos)}` +
        `&estados=ACTIVO`;

      logger.info(`📡 Buscando incidências para polo=${polos}...`);
      const data = await proxy.get(url, token);

      const items = proxy.normalizeItems(data);
      const total = data.total ?? data.totalCount ?? data.recordsTotal ?? items.length;

      logger.info(`✅ ${items.length} incidências recebidas (total: ${total})`);
      if (items.length > 0) {
        logger.info(`  Campos do 1º item: ${Object.keys(items[0]).slice(0, 10).join(', ')}...`);
      } else {
        logger.info(`  ⚠️ Nenhum item! Response keys: ${Object.keys(data).join(', ')}`);
      }

      res.json({ success: true, items, total, polo: polos, timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error(`Erro proxy incidencias: ${err.message}`);
      res.status(500).json({ success: false, error: err.message, items: [] });
    }
  });

  // ── Proxy: equipes ──

  router.get('/api/dash/equipes', async (req, res) => {
    try {
      const token = authProvider?.getToken();
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Token não disponível. Aguarde a autenticação.',
          items: [],
        });
      }

      const baseUrl = config.operview.domainApi;
      if (!baseUrl) {
        return res.status(500).json({
          success: false,
          error: 'OPERVIEW_DOMAIN_API não configurado no .env',
          items: [],
        });
      }

      const polos = req.query.polos || 'ATLANTICO';
      const url =
        `${baseUrl}/dashboards/tempo-real-produtividade/equipe-em-turno` +
        `?polos=${encodeURIComponent(polos)}` +
        `&sucursais=&tipos=&niveisTensao=&alimentadores=&tiposEquipes=&setoresEquipes=`;

      logger.info(`📡 Buscando equipes para polo=${polos}...`);
      const data = await proxy.get(url, token);

      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (typeof data === 'object' && data !== null) {
        if (Array.isArray(data.items)) items = data.items;
        else if (Array.isArray(data.data)) items = data.data;
        else {
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key]) && data[key].length > 0) {
              logger.info(`Equipes encontradas em data.${key}`);
              items = data[key];
              break;
            }
          }
        }
      }

      logger.info(`✅ ${items.length} equipes recebidas`);

      res.json({
        success: true,
        items,
        total: items.length,
        polo: polos,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(`Erro proxy equipes: ${err.message}`);
      res.status(500).json({ success: false, error: err.message, items: [] });
    }
  });

  return router;
}

module.exports = createDashboardRouter;
