/**
 * Middleware — Error Handler
 *
 * Captura exceções não tratadas nos handlers e retorna JSON padronizado.
 */
const Logger = require('../../shared/Logger');

const logger = Logger.create('ErrorHandler');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.originalUrl} — ${err.message}`);

  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message,
  });
}

module.exports = errorHandler;
