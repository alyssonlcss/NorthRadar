/**
 * DashboardProxy
 *
 * Helper que faz GET autenticado contra a API Operview,
 * com re-autenticação automática em caso de 401/403.
 * Usado pelo DashboardRouter para os endpoints de proxy.
 */
const Logger = require('../../shared/Logger');

class DashboardProxy {
  /**
   * @param {import('../auth/AuthProvider')} authProvider
   */
  constructor(authProvider) {
    this._authProvider = authProvider;
    this._logger = Logger.create('DashProxy');
  }

  /**
   * Faz GET com Bearer token, re-autentica se necessário.
   * @param {string} url
   * @param {string} token
   * @returns {Promise<any>}
   */
  async get(url, token) {
    this._logger.info(`GET ${url}`);

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/plain, */*',
      },
    });

    if ((response.status === 401 || response.status === 403) && this._authProvider) {
      this._logger.warn(`${response.status} — forçando re-autenticação...`);
      await this._authProvider.reAuthenticate();
      const newToken = this._authProvider.getToken();

      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${newToken}`,
          Accept: 'application/json, text/plain, */*',
        },
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${body.substring(0, 200)}`);
    }

    return response.json();
  }

  /**
   * Normaliza resposta da API em array de items.
   * @param {any} data
   * @returns {any[]}
   */
  normalizeItems(data) {
    if (Array.isArray(data)) return data;

    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.data)) return data.data;
      if (Array.isArray(data.incidencias)) return data.incidencias;
      if (Array.isArray(data.content)) return data.content;
      if (Array.isArray(data.results)) return data.results;

      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          this._logger.info(`Items encontrados em data.${key}`);
          return data[key];
        }
      }
    }

    return [];
  }

  /** Formata Date como YYYY-MM-DD */
  formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

module.exports = DashboardProxy;
