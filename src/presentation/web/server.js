/**
 * Presentation — Express Web Server
 *
 * Serve a API REST e o dashboard HTML.
 * Recebe o Scheduler como dependência injetada.
 */
const express = require('express');
const path = require('path');

class WebServer {
  /**
   * @param {import('../../application/use-cases/Scheduler')} scheduler
   * @param {number} port
   */
  constructor(scheduler, port = 3000) {
    this._scheduler = scheduler;
    this._port = port;
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
      res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
    });
  }
}

module.exports = WebServer;
