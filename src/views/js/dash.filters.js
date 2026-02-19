/**
 * NorthRadar – AngularJS Filters
 *
 * Filtros reutilizáveis para uso direto nos templates.
 * Ex: {{ eq.dataHoraInicio | dashDateTime }}
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .filter('dashDateTime', ['DashHelpers', function (DashHelpers) {
      return function (input) {
        return DashHelpers.formatDateTime(input);
      };
    }]);

})();
