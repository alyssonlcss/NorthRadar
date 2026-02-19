/**
 * NorthRadar – Dashboard API Service
 *
 * Responsável EXCLUSIVAMENTE pela comunicação HTTP com o backend.
 * Retorna os dados brutos (sem processamento de negócio).
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .factory('DashApi', ['$http', DashApi]);

  function DashApi($http) {

    return {
      getStatus: getStatus,
      getIncidencias: getIncidencias,
      getEquipes: getEquipes,
      getDebug: getDebug
    };

    // ─────────────────────────────────────────────────────

    /**
     * Verifica status de autenticação do servidor.
     * @returns {Promise<Object>} { auth: { hasToken, tokenPreview }, config: { domainApi } }
     */
    function getStatus() {
      return $http.get('/api/dash/status')
        .then(function (res) { return res.data; });
    }

    /**
     * Busca incidências do polo.
     * @param {string} polo - Nome do polo (ex: 'ATLANTICO')
     * @returns {Promise<Object>} { items: [], total: number, ... }
     */
    function getIncidencias(polo) {
      return $http.get('/api/dash/incidencias', { params: { polos: polo } })
        .then(function (res) {
          var data = res.data;

          if (data.success === false) {
            throw { data: data, statusText: data.error };
          }

          var items = data.items || [];

          // Fallback: se items vazio, procura array em qualquer chave
          if (items.length === 0 && typeof data === 'object') {
            var dataKeys = Object.keys(data);
            for (var ki = 0; ki < dataKeys.length; ki++) {
              if (Array.isArray(data[dataKeys[ki]]) && data[dataKeys[ki]].length > 0) {
                console.log('[DashApi] Items encontrados na chave: ' + dataKeys[ki]);
                items = data[dataKeys[ki]];
                break;
              }
            }
          }

          console.log('[DashApi] Recebidas ' + items.length + ' incidências (total: ' + (data.total || items.length) + ')');

          if (items.length > 0) {
            console.log('[DashApi] Amostra item[0] — campos:', Object.keys(items[0]).join(', '));
          } else {
            console.warn('[DashApi] ⚠️ NENHUM item retornado! Response keys:', Object.keys(data).join(', '));
          }

          return items;
        });
    }

    /**
     * Busca equipes do polo.
     * @param {string} polo
     * @returns {Promise<Array>}
     */
    function getEquipes(polo) {
      return $http.get('/api/dash/equipes', { params: { polos: polo } })
        .then(function (res) {
          var data = res.data;

          if (data.success === false) {
            throw { data: data, statusText: data.error };
          }

          var list = data.items || [];
          console.log('[DashApi] Recebidas ' + list.length + ' equipes');

          if (list.length > 0) {
            console.log('[DashApi] Amostra equipe[0] — campos:', Object.keys(list[0]).join(', '));
          }

          return list;
        });
    }

    /**
     * Endpoint de debug.
     * @param {string} polo
     * @returns {Promise<Object>}
     */
    function getDebug(polo) {
      return $http.get('/api/dash/debug', { params: { polos: polo } })
        .then(function (res) { return res.data; });
    }
  }

})();
