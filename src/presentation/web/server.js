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

    /** GET /api/dash/incidencias — proxy para Operview */
    this._app.get('/api/dash/incidencias', async (req, res) => {
      try {
        const token = this._authProvider?.getToken();
        if (!token) {
          return res.status(401).json({ error: 'Token não disponível. Aguarde a autenticação.' });
        }

        const polos = req.query.polos || 'ATLANTICO';
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const dataInicio = this._formatDate(threeDaysAgo) + ' 00:00:00';
        const dataFim = this._formatDate(now) + ' 23:59:59';

        const baseUrl = config.operview.domainApi;
        const url = `${baseUrl}/incidencias/consultar?colNumOrder=0&orderAsc=true&skip=0&take=5000` +
          `&dataInicio=${encodeURIComponent(dataInicio)}` +
          `&dataFim=${encodeURIComponent(dataFim)}` +
          `&polos=${encodeURIComponent(polos)}` +
          `&estados=ACTIVO`;

        const data = await this._proxyGet(url, token);
        res.json(data);
      } catch (err) {
        console.error('[WebServer] Erro proxy incidencias:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    /** GET /api/dash/equipes — proxy para Operview equipe-em-turno */
    this._app.get('/api/dash/equipes', async (req, res) => {
      try {
        const token = this._authProvider?.getToken();
        if (!token) {
          return res.status(401).json({ error: 'Token não disponível. Aguarde a autenticação.' });
        }

        const polos = req.query.polos || 'ATLANTICO';
        const baseUrl = config.operview.domainApi;
        const url = `${baseUrl}/dashboards/tempo-real-produtividade/equipe-em-turno` +
          `?polos=${encodeURIComponent(polos)}` +
          `&sucursais=&tipos=&niveisTensao=&alimentadores=&tiposEquipes=&setoresEquipes=`;

        const data = await this._proxyGet(url, token);
        res.json(data);
      } catch (err) {
        console.error('[WebServer] Erro proxy equipes:', err.message);
        res.status(500).json({ error: err.message });
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
