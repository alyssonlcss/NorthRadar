/**
 * Domain Interface — IIncidenceRepository
 *
 * Contrato para consultar incidências.
 * A camada de Application depende SOMENTE desta interface.
 */
class IIncidenceRepository {
  /**
   * Busca incidências com filtros e paginação
   * @param {Object} params
   * @param {string}  params.polo        — ex.: 'ATLANTICO'
   * @param {number}  [params.skip=0]
   * @param {number}  [params.take=50]
   * @param {number}  [params.colNumOrder=0]
   * @param {boolean} [params.orderAsc=true]
   * @returns {Promise<{items: import('../entities/Incidence')[], total: number}>}
   */
  async findAll(params) {
    throw new Error('IIncidenceRepository.findAll() não implementado');
  }
}

module.exports = IIncidenceRepository;
