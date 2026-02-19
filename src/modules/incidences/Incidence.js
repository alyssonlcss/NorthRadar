/**
 * Incidence — modelo de dados
 *
 * Representa uma incidência do sistema Operview.
 * Sem dependências externas.
 */
class Incidence {
  /**
   * @param {Object} props
   * @param {string}  props.id
   * @param {string}  props.polo
   * @param {string}  props.regional
   * @param {string}  props.localidade
   * @param {string}  props.causa
   * @param {string}  props.status
   * @param {number}  props.clientesAfetados
   * @param {string}  props.dataInicio
   * @param {string|null} props.dataFim
   * @param {string|null} props.observacao
   */
  constructor({
    id,
    polo,
    regional,
    localidade,
    causa,
    status,
    clientesAfetados,
    dataInicio,
    dataFim = null,
    observacao = null,
  }) {
    this.id = id;
    this.polo = polo;
    this.regional = regional;
    this.localidade = localidade;
    this.causa = causa;
    this.status = status;
    this.clientesAfetados = clientesAfetados;
    this.dataInicio = dataInicio;
    this.dataFim = dataFim;
    this.observacao = observacao;
  }

  /** Está resolvida? */
  get isResolved() {
    return this.dataFim !== null;
  }

  /** Duração em minutos (ou null se em aberto) */
  get durationMinutes() {
    if (!this.dataFim) return null;
    return Math.round(
      (new Date(this.dataFim) - new Date(this.dataInicio)) / 60000,
    );
  }

  /** Serializa para JSON plano */
  toJSON() {
    return {
      id: this.id,
      polo: this.polo,
      regional: this.regional,
      localidade: this.localidade,
      causa: this.causa,
      status: this.status,
      clientesAfetados: this.clientesAfetados,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
      observacao: this.observacao,
      isResolved: this.isResolved,
      durationMinutes: this.durationMinutes,
    };
  }
}

module.exports = Incidence;
