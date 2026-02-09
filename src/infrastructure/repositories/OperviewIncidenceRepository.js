/**
 * Infrastructure — OperviewIncidenceRepository
 *
 * Implementação concreta de IIncidenceRepository.
 * Faz GET na API Operview com Bearer token.
 */
const IIncidenceRepository = require('../../domain/repositories/IIncidenceRepository');
const Incidence = require('../../domain/entities/Incidence');
const HttpClient = require('../http/HttpClient');
const config = require('../../config');

class OperviewIncidenceRepository extends IIncidenceRepository {
  /**
   * @param {import('../../domain/repositories/IAuthProvider')} authProvider
   */
  constructor(authProvider) {
    super();
    this._authProvider = authProvider;
    this._http = new HttpClient(config.operview.domainApi);
  }

  /**
   * GET /incidencias/consultar
   * @param {Object} params
   * @returns {Promise<{items: Incidence[], total: number}>}
   */
  async findAll({
    polo = 'ATLANTICO',
    skip = 0,
    take = 50,
    colNumOrder = 0,
    orderAsc = true,
  } = {}) {
    const token = this._authProvider.getToken();

    if (!token) {
      throw new Error('Token não disponível. Execute authProvider.initialize() antes.');
    }

    const data = await this._http.get(
      '/incidencias/consultar',
      { colNumOrder, orderAsc, skip, take, polos: polo },
      token
    );

    // Mapear resposta bruta → entidades de domínio
    const rawItems = data.items || data.data || data || [];
    const items = Array.isArray(rawItems)
      ? rawItems.map((raw) => this._toDomain(raw))
      : [];

    return {
      items,
      total: data.total ?? data.totalCount ?? items.length,
      raw: data, // manter original para debug
    };
  }

  /**
   * Converte objeto cru da API → entidade Incidence
   * (campos serão ajustados quando virmos o payload real)
   */
  _toDomain(raw) {
    return new Incidence({
      id: raw.id ?? raw.incidenciaId ?? raw.codigo ?? String(Math.random()),
      polo: raw.polo ?? raw.nomePolo ?? '',
      regional: raw.regional ?? raw.nomeRegional ?? '',
      localidade: raw.localidade ?? raw.nomeLocalidade ?? '',
      causa: raw.causa ?? raw.descricaoCausa ?? '',
      status: raw.status ?? raw.descricaoStatus ?? '',
      clientesAfetados: raw.clientesAfetados ?? raw.qtdClientesAfetados ?? 0,
      dataInicio: raw.dataInicio ?? raw.dataInicioIncidencia ?? null,
      dataFim: raw.dataFim ?? raw.dataFimIncidencia ?? null,
      observacao: raw.observacao ?? null,
    });
  }
}

module.exports = OperviewIncidenceRepository;
