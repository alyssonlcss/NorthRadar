/**
 * NorthRadar – Dashboard Helpers (pure functions)
 *
 * Funções utilitárias sem dependência de AngularJS.
 * Usadas por factories e controller via injeção.
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .factory('DashHelpers', DashHelpers);

  function DashHelpers() {

    return {
      parseDuracao: parseDuracao,
      isActive: isActive,
      mapIncidence: mapIncidence,
      getField: getField,
      padZero: padZero,
      formatDateTime: formatDateTime
    };

    // ─────────────────────────────────────────────────────

    /**
     * Converte "duracao" no formato "HH:mm" para horas decimais.
     * Ex: "03:11" → 3.183..., "48:30" → 48.5
     * Retorna 0 se formato inválido.
     */
    function parseDuracao(dur) {
      if (!dur || dur === '-') return 0;
      var parts = String(dur).split(':');
      if (parts.length < 2) return parseFloat(dur) || 0;
      var h = parseInt(parts[0], 10) || 0;
      var m = parseInt(parts[1], 10) || 0;
      return h + (m / 60);
    }

    /**
     * Verifica se uma incidência está ativa:
     * estado === 'ACTIVO' E dataFim === '-' ou vazio/null
     */
    function isActive(inc) {
      var df = inc.dataFim;
      var estado = inc.estado || '';
      return estado === 'ACTIVO' && (!df || df === '-');
    }

    /**
     * Mapeia uma incidência da API para o formato das tabelas TOP 10.
     */
    function mapIncidence(inc) {
      var cli = inc.clientesAfetadosAtual || 0;
      var duracaoStr = inc.duracao || '00:00';
      var duracaoHours = parseDuracao(duracaoStr);
      var chiVal = cli * duracaoHours;

      return {
        incidencia: inc.numero || '',
        polo: inc.polo || '',
        nt: inc.nivelTensao || '',
        cli: cli,
        chi: Math.round(chiVal * 10) / 10,
        tma: duracaoHours,
        tmaFormatted: duracaoStr,
        avisos: inc.totalAvisos || 0,
        atribuicao: (inc.equipeDeslocada && inc.equipeDeslocada !== '-' ? inc.equipeDeslocada : null) || inc.equipeAtribuida || '-',
        alimentador: inc.alimentador || '',
        cd: inc.cd || ''
      };
    }

    /**
     * Retorna o primeiro campo não-null/não-vazio do objeto.
     * getField(obj, 'field1', 'field2', ...)
     */
    function getField(obj) {
      for (var i = 1; i < arguments.length; i++) {
        var val = obj[arguments[i]];
        if (val !== undefined && val !== null && val !== '') {
          return val;
        }
      }
      return null;
    }

    function padZero(n) {
      return n < 10 ? '0' + n : '' + n;
    }

    function formatDateTime(str) {
      if (!str) return '—';
      try {
        var d = new Date(str);
        if (isNaN(d.getTime())) return str;
        return padZero(d.getDate()) + '/' +
               padZero(d.getMonth() + 1) + '/' +
               d.getFullYear() + ' ' +
               padZero(d.getHours()) + ':' +
               padZero(d.getMinutes());
      } catch (e) {
        return str;
      }
    }
  }

})();
