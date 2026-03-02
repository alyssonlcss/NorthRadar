/**
 * Deslocamento — modelo de dados
 *
 * Representa uma linha da tabela de Deslocamentos do Spotfire.
 * Sem dependências externas.
 */
class Deslocamento {
  /**
   * @param {Object} props
   * @param {string}       props.polo        — Polo de origem (ATLANTICO, DECEN, DNORT)
   * @param {string}       props.dia         — Data/dia do deslocamento
   * @param {string}       props.equipe      — Código da equipe
   * @param {string}       props.ordem       — Número da OS / ordem
   * @param {string|null}  props.despachado  — Horário de despacho
   * @param {string|null}  props.aCaminho    — Horário a caminho
   * @param {string|null}  props.noLocal     — Horário de chegada no local
   * @param {string|null}  props.liberada    — Horário de liberação
   * @param {string|null}  props.inicioOs    — Horário de início da OS
   * @param {string|null}  props.fimOs       — Horário de fim da OS
   * @param {string|null}  props.qtd            — Quantidade de deslocamentos
   * @param {string|null}  props.horas          — Horas trabalhadas
   * @param {string|null}  props.emAtendimento  — Em atendimento
   */
  constructor({
    polo,
    dia,
    equipe,
    ordem,
    despachado = null,
    aCaminho = null,
    noLocal = null,
    liberada = null,
    inicioOs = null,
    fimOs = null,
    qtd = null,
    horas = null,
    emAtendimento = null,
  }) {
    this.polo = polo;
    this.dia = dia;
    this.equipe = equipe;
    this.ordem = ordem;
    this.despachado = despachado;
    this.aCaminho = aCaminho;
    this.noLocal = noLocal;
    this.liberada = liberada;
    this.inicioOs = inicioOs;
    this.fimOs = fimOs;
    this.qtd = qtd;
    this.horas = horas;
    this.emAtendimento = emAtendimento;
  }

  /** Duração total em minutos (fimOs - despachado), ou null se incompleto */
  get duracaoMinutos() {
    if (!this.despachado || !this.fimOs) return null;
    try {
      const base = new Date();
      const [hIni, mIni] = this.despachado.split(':').map(Number);
      const [hFim, mFim] = this.fimOs.split(':').map(Number);
      const ini = new Date(base.setHours(hIni, mIni, 0, 0));
      const fim = new Date(base.setHours(hFim, mFim, 0, 0));
      const diff = fim - ini;
      return diff >= 0 ? Math.round(diff / 60000) : null;
    } catch {
      return null;
    }
  }

  /** Serializa para JSON plano */
  toJSON() {
    return {
      polo: this.polo,
      dia: this.dia,
      equipe: this.equipe,
      ordem: this.ordem,
      despachado: this.despachado,
      aCaminho: this.aCaminho,
      noLocal: this.noLocal,
      liberada: this.liberada,
      inicioOs: this.inicioOs,
      fimOs: this.fimOs,
      qtd: this.qtd,
      horas: this.horas,
      emAtendimento: this.emAtendimento,
      duracaoMinutos: this.duracaoMinutos,
    };
  }
}

module.exports = Deslocamento;
