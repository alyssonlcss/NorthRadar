/**
 * IncidenceRepository
 *
 * Consulta a API Operview com Bearer token e mapeia a resposta
 * para objetos Incidence.
 */
const Incidence = require('./Incidence');
const HttpClient = require('../../shared/HttpClient');
const HttpAuthError = require('../../shared/errors/HttpAuthError');
const config = require('../../config');
const Logger = require('../../shared/Logger');

class IncidenceRepository {
  /**
   * @param {import('../auth/AuthProvider')} authProvider
   */
  constructor(authProvider) {
    this._authProvider = authProvider;
    this._http = new HttpClient(config.operview.domainApi);
    this._logger = Logger.create('IncidenceRepo');
  }

  /**
   * Busca incidências na API com filtros e paginação.
   *
   * @param {Object}  [params]
   * @param {string}  [params.polo='ATLANTICO']
   * @param {number}  [params.skip=0]
   * @param {number}  [params.take=50]
   * @param {number}  [params.colNumOrder=0]
   * @param {boolean} [params.orderAsc=true]
   * @returns {Promise<{items: Incidence[], total: number, raw: Object}>}
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

    let data;
    try {
      data = await this._http.get(
        '/incidencias/consultar',
        { colNumOrder, orderAsc, skip, take, polos: polo },
        token,
      );
    } catch (error) {
      if (error instanceof HttpAuthError) {
        this._logger.warn(`${error.status} recebido — forçando re-autenticação...`);
        await this._authProvider.reAuthenticate();
        const newToken = this._authProvider.getToken();
        data = await this._http.get(
          '/incidencias/consultar',
          { colNumOrder, orderAsc, skip, take, polos: polo },
          newToken,
        );
      } else {
        throw error;
      }
    }

    const rawItems = data.items || data.data || data || [];
    const items = Array.isArray(rawItems)
      ? rawItems.map((raw) => this._toDomain(raw))
      : [];

    return {
      items,
      total: data.total ?? data.totalCount ?? items.length,
      raw: data,
    };
  }

  /** @private */
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

module.exports = IncidenceRepository;
