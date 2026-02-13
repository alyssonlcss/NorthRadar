/**
 * Presentation — Express Web Server
 *
 * Serve a API REST e o dashboard HTML.
 * Recebe o Scheduler como dependência injetada.
 */
const express = require('express');
const path = require('path');
const config = require('../../config');

class WebServer {
  /**
   * @param {import('../../application/use-cases/Scheduler')} scheduler
   * @param {number} port
   * @param {import('../../domain/repositories/IAuthProvider')} authProvider
   */
  constructor(scheduler, port = 3000, authProvider = null) {
    this._scheduler = scheduler;
    this._port = port;
    this._authProvider = authProvider;
    this._app = express();
    this._server = null;

    this._setupMiddleware();
    this._setupRoutes();
  }

  /** Inicia o servidor */
  async start() {
    return new Promise((resolve) => {
      this._server = this._app.listen(this._port, () => {
        console.log(`[WebServer] ✅ Dashboard: http://localhost:${this._port}`);
        resolve();
      });
    });
  }

  /** Para o servidor */
  async stop() {
    if (this._server) {
      this._server.close();
      console.log('[WebServer] Servidor encerrado');
    }
  }

  _setupMiddleware() {
    this._app.use(express.json());
    this._app.use(
      express.static(path.join(__dirname, 'views'))
    );
  }

  _setupRoutes() {
    // ── API REST ──

    /** GET /api/incidences — dados do cache */
    this._app.get('/api/incidences', (req, res) => {
      const data = this._scheduler.getData();
      res.json({
        success: true,
        lastUpdated: data.lastUpdated,
        total: data.incidences.total,
        items: data.incidences.items,
      });
    });

    /** GET /api/health — health check */
    this._app.get('/api/health', (req, res) => {
      const data = this._scheduler.getData();
      res.json({
        status: 'ok',
        lastUpdated: data.lastUpdated,
        uptime: process.uptime(),
      });
    });

    // ── Dashboard HTML ──

    /** GET / — página principal */
    this._app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'dash.html'));
    });

    /** GET /dash — dashboard operacional Angular */
    this._app.get('/dash', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'dash.html'));
    });

    // ── Proxy API para o Dashboard /dash ──

    /** GET /api/dash/status — status de autenticação e conectividade */
    this._app.get('/api/dash/status', (req, res) => {
      const token = this._authProvider?.getToken();
      const hasToken = !!token;
      const tokenPreview = hasToken ? token.substring(0, 30) + '...' : null;
      const baseUrl = config.operview.domainApi || '(NÃO CONFIGURADO)';

      res.json({
        success: true,
        auth: {
          hasToken,
          tokenPreview,
          isAuthenticated: this._authProvider?.isAuthenticated?.() || false,
        },
        config: {
          domainApi: baseUrl,
          port: this._port,
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });

    /** GET /api/dash/debug — testa a API e retorna resposta bruta para diagnóstico */
    this._app.get('/api/dash/debug', async (req, res) => {
      const result = { timestamp: new Date().toISOString(), tests: {} };
      const token = this._authProvider?.getToken();

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
      const dataInicio = this._formatDate(threeDaysAgo) + ' 00:00:00';
      const dataFim = this._formatDate(now) + ' 23:59:59';

      // Teste 1: incidências (take=5 apenas para debug)
      try {
        const urlInc = `${baseUrl}/incidencias/consultar?colNumOrder=0&orderAsc=true&skip=0&take=5` +
          `&dataInicio=${encodeURIComponent(dataInicio)}` +
          `&dataFim=${encodeURIComponent(dataFim)}` +
          `&polos=${encodeURIComponent(polos)}` +
          `&estados=ACTIVO`;
        result.tests.incidencias = { url: urlInc };
        const rawInc = await this._proxyGet(urlInc, token);
        const keys = Object.keys(rawInc);
        result.tests.incidencias.responseKeys = keys;
        result.tests.incidencias.isArray = Array.isArray(rawInc);

        // Descobrir onde estão os items
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
        result.tests.incidencias.total = rawInc.total ?? rawInc.totalCount ?? rawInc.recordsTotal ?? null;
        if (items.length > 0) {
          result.tests.incidencias.sampleItemKeys = Object.keys(items[0]);
          result.tests.incidencias.sampleItem = items[0];
        }
      } catch (err) {
        result.tests.incidencias = { error: err.message };
      }

      // Teste 2: equipes
      try {
        const urlEq = `${baseUrl}/dashboards/tempo-real-produtividade/equipe-em-turno?polos=${encodeURIComponent(polos)}&sucursais=&tipos=&niveisTensao=&alimentadores=&tiposEquipes=&setoresEquipes=`;
        result.tests.equipes = { url: urlEq };
        const rawEq = await this._proxyGet(urlEq, token);
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

    /** GET /api/dash/incidencias — proxy para Operview */
    this._app.get('/api/dash/incidencias', async (req, res) => {
      try {
        const token = this._authProvider?.getToken();
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
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const dataInicio = this._formatDate(threeDaysAgo) + ' 00:00:00';
        const dataFim = this._formatDate(now) + ' 23:59:59';

        const url = `${baseUrl}/incidencias/consultar?colNumOrder=0&orderAsc=true&skip=0&take=5000` +
          `&dataInicio=${encodeURIComponent(dataInicio)}` +
          `&dataFim=${encodeURIComponent(dataFim)}` +
          `&polos=${encodeURIComponent(polos)}` +
          `&estados=ACTIVO`;

        console.log(`[WebServer] 📡 Buscando incidências para polo=${polos}...`);
        const data = await this._proxyGet(url, token);

        // Normalizar resposta — procura array em qualquer chave
        let items = [];
        if (Array.isArray(data)) {
          items = data;
        } else if (typeof data === 'object' && data !== null) {
          // Tentar chaves conhecidas primeiro, depois qualquer array
          if (Array.isArray(data.items)) items = data.items;
          else if (Array.isArray(data.data)) items = data.data;
          else if (Array.isArray(data.incidencias)) items = data.incidencias;
          else if (Array.isArray(data.content)) items = data.content;
          else if (Array.isArray(data.results)) items = data.results;
          else {
            // Buscar qualquer propriedade que seja array
            for (const key of Object.keys(data)) {
              if (Array.isArray(data[key]) && data[key].length > 0) {
                console.log(`[WebServer] Items encontrados em data.${key}`);
                items = data[key];
                break;
              }
            }
          }
        }

        const total = data.total ?? data.totalCount ?? data.recordsTotal ?? items.length;
        console.log(`[WebServer] ✅ ${items.length} incidências recebidas (total: ${total})`);
        if (items.length > 0) {
          console.log(`[WebServer]   Campos do 1º item: ${Object.keys(items[0]).slice(0, 10).join(', ')}...`);
        } else {
          console.log(`[WebServer]   ⚠️ Nenhum item! Response keys: ${Object.keys(data).join(', ')}`);
        }

        res.json({
          success: true,
          items,
          total,
          polo: polos,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[WebServer] ❌ Erro proxy incidencias:', err.message);
        res.status(500).json({
          success: false,
          error: err.message,
          items: [],
        });
      }
    });

    /** GET /api/dash/equipes — proxy para Operview equipe-em-turno */
    this._app.get('/api/dash/equipes', async (req, res) => {
      try {
        const token = this._authProvider?.getToken();
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
        const url = `${baseUrl}/dashboards/tempo-real-produtividade/equipe-em-turno` +
          `?polos=${encodeURIComponent(polos)}` +
          `&sucursais=&tipos=&niveisTensao=&alimentadores=&tiposEquipes=&setoresEquipes=`;

        console.log(`[WebServer] 📡 Buscando equipes para polo=${polos}...`);
        const data = await this._proxyGet(url, token);

        // Normalizar resposta — procura array em qualquer chave
        let items = [];
        if (Array.isArray(data)) {
          items = data;
        } else if (typeof data === 'object' && data !== null) {
          if (Array.isArray(data.items)) items = data.items;
          else if (Array.isArray(data.data)) items = data.data;
          else {
            for (const key of Object.keys(data)) {
              if (Array.isArray(data[key]) && data[key].length > 0) {
                console.log(`[WebServer] Equipes encontradas em data.${key}`);
                items = data[key];
                break;
              }
            }
          }
        }

        console.log(`[WebServer] ✅ ${items.length} equipes recebidas`);

        res.json({
          success: true,
          items,
          total: items.length,
          polo: polos,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[WebServer] ❌ Erro proxy equipes:', err.message);
        res.status(500).json({
          success: false,
          error: err.message,
          items: [],
        });
      }
    });
  }

  // ── Helpers ──

  /** Faz GET com Bearer token, re-autentica em caso de 401/403 */
  async _proxyGet(url, token) {
    console.log(`[WebServer] Proxy GET ${url}`);

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, text/plain, */*',
      },
    });

    // Re-autenticar se 401/403
    if ((response.status === 401 || response.status === 403) && this._authProvider) {
      console.warn(`[WebServer] ${response.status} — forçando re-autenticação...`);
      await this._authProvider.reAuthenticate();
      const newToken = this._authProvider.getToken();

      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Accept': 'application/json, text/plain, */*',
        },
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${body.substring(0, 200)}`);
    }

    return response.json();
  }

  /** Formata Date como YYYY-MM-DD */
  _formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

module.exports = WebServer;
