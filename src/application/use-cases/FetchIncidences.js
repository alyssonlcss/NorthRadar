/**
 * Application — FetchIncidences Use Case
 *
 * Orquestra a busca de incidências usando as interfaces do Domain.
 * Não conhece detalhes de infraestrutura (HTTP, Puppeteer etc).
 */
class FetchIncidences {
  /**
   * @param {import('../../domain/repositories/IIncidenceRepository')} incidenceRepo
   */
  constructor(incidenceRepo) {
    this._repo = incidenceRepo;
  }

  /**
   * Executa a consulta
   * @param {Object} [filters]
   * @param {string}  [filters.polo='ATLANTICO']
   * @param {number}  [filters.skip=0]
   * @param {number}  [filters.take=50]
   * @returns {Promise<{items: import('../../domain/entities/Incidence')[], total: number}>}
   */
  async execute(filters = {}) {
    console.log('[UseCase] FetchIncidences —', JSON.stringify(filters));

    const result = await this._repo.findAll({
      polo: filters.polo || 'ATLANTICO',
      skip: filters.skip || 0,
      take: filters.take || 50,
      colNumOrder: filters.colNumOrder ?? 0,
      orderAsc: filters.orderAsc ?? true,
    });

    console.log(`[UseCase] ${result.items.length} incidências obtidas (total: ${result.total})`);
    return result;
  }
}

module.exports = FetchIncidences;
