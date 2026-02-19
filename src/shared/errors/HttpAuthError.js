/**
 * HttpAuthError
 *
 * Erro específico para falhas de autenticação HTTP (401/403).
 * Permite que módulos detectem e disparem re-autenticação.
 */
class HttpAuthError extends Error {
  constructor(status, statusText, url, body = '') {
    super(`HTTP ${status} ${statusText} — ${url}\n${body}`);
    this.name = 'HttpAuthError';
    this.status = status;
  }
}

module.exports = HttpAuthError;
