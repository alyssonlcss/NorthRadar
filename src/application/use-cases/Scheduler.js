/**
 * Application — Scheduler
 *
 * Executa os use-cases periodicamente e mantém cache em memória
 * para servir ao dashboard sem bater na API a cada request.
 */
class Scheduler {
  /**
   * @param {import('./FetchIncidences')} fetchIncidencesUC
   * @param {number} intervalMs — padrão 60 min
   */
  constructor(fetchIncidencesUC, intervalMs = 60 * 60 * 1000) {
    this._fetchUC = fetchIncidencesUC;
    this._intervalMs = intervalMs;
    this._timer = null;

    /** Cache em memória — lido pela Presentation */
    this._cache = {
      incidences: { items: [], total: 0 },
      lastUpdated: null,
    };
  }

  /** Executa a primeira carga e inicia o timer */
  async start() {
    console.log(`[Scheduler] Iniciando — refresh a cada ${this._intervalMs / 60000} min`);

    await this._tick(); // primeira carga imediata

    this._timer = setInterval(() => this._tick(), this._intervalMs);
  }

  /** Para o scheduler */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[Scheduler] Parado');
  }

  /** Retorna dados do cache */
  getData() {
    return { ...this._cache };
  }

  // ── privado ──

  async _tick() {
    try {
      console.log(`[Scheduler] Atualizando dados... (${new Date().toLocaleTimeString()})`);
      const result = await this._fetchUC.execute({ polo: 'ATLANTICO' });
      this._cache.incidences = result;
      this._cache.lastUpdated = new Date().toISOString();
      console.log('[Scheduler] ✅ Cache atualizado');
    } catch (error) {
      console.error('[Scheduler] ❌ Erro ao atualizar:', error.message);
    }
  }
}

module.exports = Scheduler;
