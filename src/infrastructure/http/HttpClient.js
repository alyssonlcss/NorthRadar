/**
 * Infrastructure — HttpClient
 *
 * Cliente HTTP genérico usando fetch nativo do Node 18+.
 * Centraliza headers, Bearer token e tratamento de erros.
 */

/**
 * Erro específico para falhas de autenticação (401/403).
 * Permite que camadas superiores detectem e disparem re-autenticação.
 */
class HttpAuthError extends Error {
  constructor(status, statusText, url, body = '') {
    super(`HTTP ${status} ${statusText} — ${url}\n${body}`);
    this.name = 'HttpAuthError';
    this.status = status;
  }
}

class HttpClient {
  /**
   * @param {string} baseURL — ex.: 'https://operview-ce-dapi.enel.com'
   */
  constructor(baseURL) {
    this._baseURL = baseURL.replace(/\/+$/, '');
  }

  /**
   * GET com Bearer token
   * @param {string} path    — ex.: '/incidencias/consultar'
   * @param {Object} [query] — query-string params
   * @param {string} [token] — JWT token
   * @returns {Promise<any>}
   */
  async get(path, query = {}, token = null) {
    const url = this._buildURL(path, query);
    const headers = this._buildHeaders(token);

    console.log(`[HttpClient] GET ${url}`);

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new HttpAuthError(response.status, response.statusText, url, body);
      }
      throw new Error(
        `HTTP ${response.status} ${response.statusText} — ${url}\n${body}`
      );
    }

    return response.json();
  }

  /**
   * POST com Bearer token
   * @param {string} path
   * @param {Object} body
   * @param {string} [token]
   * @returns {Promise<any>}
   */
  async post(path, body = {}, token = null) {
    const url = this._buildURL(path);
    const headers = this._buildHeaders(token);

    console.log(`[HttpClient] POST ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new HttpAuthError(response.status, response.statusText, url, text);
      }
      throw new Error(
        `HTTP ${response.status} ${response.statusText} — ${url}\n${text}`
      );
    }

    return response.json();
  }

  // ── privados ──

  _buildURL(path, query = {}) {
    const url = new URL(path, this._baseURL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  _buildHeaders(token) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }
}

module.exports = HttpClient;
module.exports.HttpAuthError = HttpAuthError;
