/**
 * IncidenceService
 *
 * Serviço que unifica:
 *   - Busca de incidências (via IncidenceRepository)
 *   - Cache em memória
 *   - Scheduler de auto-refresh periódico
 *
 * A camada de server lê os dados daqui sem bater na API a cada request.
 */
const Logger = require('../../shared/Logger');

class IncidenceService {
  /**
   * @param {import('./IncidenceRepository')} repository
   * @param {number} refreshIntervalMs — intervalo de refresh (padrão: 60 min)
   */
  constructor(repository, refreshIntervalMs = 60 * 60 * 1000) {
    this._repo = repository;
    this._intervalMs = refreshIntervalMs;
    this._timer = null;
    this._logger = Logger.create('IncidenceService');

    /** Cache em memória */
    this._cache = {
      incidences: { items: [], total: 0 },
      lastUpdated: null,
    };
  }

  // ── Busca avulsa ──

  /**
   * Busca incidências aplicando filtros.
   * @param {Object} [filters]
   * @returns {Promise<{items: import('./Incidence')[], total: number}>}
   */
  async fetch(filters = {}) {
    this._logger.info(`Buscando — ${JSON.stringify(filters)}`);

    const result = await this._repo.findAll({
      polo: filters.polo || 'ATLANTICO',
      skip: filters.skip || 0,
      take: filters.take || 50,
      colNumOrder: filters.colNumOrder ?? 0,
      orderAsc: filters.orderAsc ?? true,
    });

    this._logger.info(`${result.items.length} incidências obtidas (total: ${result.total})`);
    return result;
  }

  // ── Scheduler (cache + timer) ──

  /** Executa a primeira carga e inicia o timer de auto-refresh. */
  async startScheduler() {
    this._logger.info(`Iniciando scheduler — refresh a cada ${this._intervalMs / 60000} min`);
    await this._tick();
    this._timer = setInterval(() => this._tick(), this._intervalMs);
  }

  /** Para o scheduler. */
  stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._logger.info('Scheduler parado');
  }

  /** Retorna uma cópia dos dados em cache. */
  getData() {
    return { ...this._cache };
  }

  /** @private */
  async _tick() {
    try {
      this._logger.info(`Atualizando dados... (${new Date().toLocaleTimeString()})`);
      const result = await this.fetch({ polo: 'ATLANTICO' });
      this._cache.incidences = result;
      this._cache.lastUpdated = new Date().toISOString();
      this._logger.info('✅ Cache atualizado');
    } catch (error) {
      this._logger.error(`Erro ao atualizar: ${error.message}`);
    }
  }
}

module.exports = IncidenceService;
