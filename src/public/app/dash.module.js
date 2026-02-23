/**
 * NorthRadar – AngularJS Module Declaration
 *
 * Ponto central do módulo. Todos os demais arquivos
 * (factories, controller, filters) se registram neste módulo.
 */
(function () {
  'use strict';

  angular.module('dashApp', []);

  // ── Drag-and-drop directives (HTML5 native) ────────────
  angular.module('dashApp')
    .directive('ngDragStart', function () {
      return function (scope, el, attrs) {
        el[0].addEventListener('dragstart', function (e) {
          scope.$apply(function () { scope.$eval(attrs.ngDragStart, { $event: e }); });
        });
      };
    })
    .directive('ngDragOver', function () {
      return function (scope, el, attrs) {
        el[0].addEventListener('dragover', function (e) {
          e.preventDefault();
          scope.$apply(function () { scope.$eval(attrs.ngDragOver, { $event: e }); });
        });
      };
    })
    .directive('ngDragLeave', function () {
      return function (scope, el, attrs) {
        el[0].addEventListener('dragleave', function (e) {
          scope.$apply(function () { scope.$eval(attrs.ngDragLeave, { $event: e }); });
        });
      };
    })
    .directive('ngDrop', function () {
      return function (scope, el, attrs) {
        el[0].addEventListener('drop', function (e) {
          e.preventDefault();
          scope.$apply(function () { scope.$eval(attrs.ngDrop, { $event: e }); });
        });
      };
    })
    .directive('ngDragEnd', function () {
      return function (scope, el, attrs) {
        el[0].addEventListener('dragend', function (e) {
          scope.$apply(function () { scope.$eval(attrs.ngDragEnd, { $event: e }); });
        });
      };
    });

})();
