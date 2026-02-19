/**
 * Logger — utilitário transversal
 *
 * Logger estruturado leve. Cada módulo instancia com seu próprio contexto.
 *
 * Uso:
 *   const Logger = require('../shared/Logger');
 *   const log = Logger.create('MeuModulo');
 *   log.info('ok');       // [MeuModulo] ok
 *   log.warn('cuidado');  // [MeuModulo] ⚠️  cuidado
 *   log.error('falhou');  // [MeuModulo] ❌ falhou
 */
class Logger {
  constructor(context) {
    this._ctx = context;
  }

  info(msg, ...args) {
    console.log(`[${this._ctx}] ${msg}`, ...args);
  }

  warn(msg, ...args) {
    console.warn(`[${this._ctx}] ⚠️  ${msg}`, ...args);
  }

  error(msg, ...args) {
    console.error(`[${this._ctx}] ❌ ${msg}`, ...args);
  }

  static create(context) {
    return new Logger(context);
  }
}

module.exports = Logger;
