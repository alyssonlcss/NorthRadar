/**
 * HttpClient — cliente HTTP genérico
 *
 * Usa fetch nativo do Node 18+.
 * Centraliza headers, Bearer token e tratamento de erros.
 */
const HttpAuthError = require('./errors/HttpAuthError');
const Logger = require('./Logger');

class HttpClient {
  /**
   * @param {string} baseURL — ex.: 'https://operview-ce-dapi.enel.com'
   */
  constructor(baseURL) {
    this._baseURL = baseURL.replace(/\/+$/, '');
    this._logger = Logger.create('HttpClient');
  }

  /**
   * GET com Bearer token
   * @param {string} path
   * @param {Object} [query]
   * @param {string} [token]
   * @returns {Promise<any>}
   */
  async get(path, query = {}, token = null) {
    const url = this._buildURL(path, query);
    const headers = this._buildHeaders(token);

    this._logger.info(`GET ${url}`);

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new HttpAuthError(response.status, response.statusText, url, body);
      }
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}\n${body}`);
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

    this._logger.info(`POST ${url}`);

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
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}\n${text}`);
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
