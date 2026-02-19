/**
 * ExpressServer
 *
 * Configura e inicia o servidor Express.
 * Recebe dependências via construtor (Dependency Injection).
 */
const express = require('express');
const path = require('path');

const registerRoutes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const Logger = require('../shared/Logger');

class ExpressServer {
  /**
   * @param {Object} deps
   * @param {import('../modules/incidences/IncidenceService')} deps.incidenceService
   * @param {import('../modules/auth/AuthProvider')}           deps.authProvider
   * @param {number} [port=3000]
   */
  constructor({ incidenceService, authProvider }, port = 3000) {
    this._port = port;
    this._server = null;
    this._logger = Logger.create('WebServer');
    this._app = express();

    this._app.use(express.json());
    this._app.use(express.static(path.join(__dirname, '..', 'public')));

    registerRoutes(this._app, { incidenceService, authProvider });

    this._app.use(errorHandler);
  }

  async start() {
    return new Promise((resolve) => {
      this._server = this._app.listen(this._port, () => {
        this._logger.info(`✅ Dashboard: http://localhost:${this._port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (this._server) {
      this._server.close();
      this._logger.info('Servidor encerrado');
    }
  }
}

module.exports = ExpressServer;
