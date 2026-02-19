/**
 * NorthRadar – Dashboard Controller (thin)
 *
 * Responsável APENAS por:
 * - Inicializar estado do view-model
 * - Ligar métodos públicos ao template
 * - Delegar para DashApi (HTTP) e DashProcessor (lógica)
 * - Orquestrar o ciclo de vida (init, refresh, retry)
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .controller('DashCtrl', [
      '$interval', '$timeout',
      'DashApi', 'DashProcessor', 'DashHelpers',
      DashCtrl
    ]);

  function DashCtrl($interval, $timeout, Api, Proc, Helpers) {
    var vm = this;

    // ── View-model state ─────────────────────────────────
    vm.polos          = ['ATLANTICO', 'DECEN', 'DNORT'];
    vm.selectedPolo   = 'ATLANTICO';
    vm.loadingInc     = true;
    vm.loadingEq      = true;
    vm.errorInc       = null;
    vm.errorEq        = null;
    vm.hasError       = false;
    vm.refreshing     = false;
    vm.lastUpdate     = null;
    vm.authReady      = false;
    vm.authStatus     = 'Verificando autenticação...';

    // ── View-model data ──────────────────────────────────
    vm.rawIncidencias   = [];
    vm.panorama         = [];
    vm.totals           = {};
    vm.kpis             = { totalIncidencias: 0, totalClientes: 0, totalEquipes: 0, naoDespachados: 0, urgentes: 0, eletrodependentes: 0, totalChi: 0 };
    vm.top10Chi         = [];
    vm.top10Tma         = [];
    vm.top10Cli         = [];
    vm.equipes          = [];
    vm.equipes2Recurso  = [];
    vm.totalEquipes     = 0;
    vm.totalEquipes2    = 0;
    vm.debugInfo        = {};
    vm.showDebug        = false;
    vm.debugResult      = null;

    // ── Public bindings ──────────────────────────────────
    vm.changePolo    = changePolo;
    vm.formatDateTime = Helpers.formatDateTime;
    vm.toggleDebug   = function () { vm.showDebug = !vm.showDebug; };
    vm.testDebug     = testDebug;

    // ── Bootstrap ────────────────────────────────────────
    checkAuthAndLoad();
    $interval(loadAll, 900000); // 15 min

    // ═══════════════════════════════════════════════════════
    // ORCHESTRATION (o controller só orquestra, não processa)
    // ═══════════════════════════════════════════════════════

    function changePolo(polo) {
      vm.selectedPolo = polo;
      loadAll();
    }

    function checkAuthAndLoad() {
      Api.getStatus()
        .then(function (s) {
          if (s.auth && s.auth.hasToken) {
            vm.authReady = true;
            vm.authStatus = 'Autenticado';
            console.log('[Ctrl] Auth OK — Token:', s.auth.tokenPreview);
            console.log('[Ctrl] API Base:', s.config.domainApi);
            loadAll();
          } else {
            vm.authStatus = 'Aguardando token — o servidor está autenticando...';
            console.warn('[Ctrl] Token indisponível, retry em 5 s...');
            $timeout(checkAuthAndLoad, 5000);
          }
        })
        .catch(function (err) {
          vm.authStatus = 'Servidor offline';
          vm.hasError = true;
          console.error('[Ctrl] Erro ao verificar status:', err);
          $timeout(checkAuthAndLoad, 10000);
        });
    }

    function loadAll() {
      if (!vm.authReady) return;
      vm.refreshing = true;
      vm.hasError = false;
      loadIncidencias();
      loadEquipes();
    }

    // ── Incidências ──────────────────────────────────────

    function loadIncidencias() {
      vm.loadingInc = true;
      vm.errorInc = null;

      console.log('[Ctrl] Buscando incidências para polo=' + vm.selectedPolo + '...');

      Api.getIncidencias(vm.selectedPolo)
        .then(function (items) {
          vm.rawIncidencias = items;

          // Delega todo o processamento
          var result     = Proc.processIncidencias(items);
          vm.panorama    = result.panorama;
          vm.totals      = result.totals;
          vm.kpis        = result.kpis;
          vm.top10Chi    = result.top10Chi;
          vm.top10Tma    = result.top10Tma;
          vm.top10Cli    = result.top10Cli;
          vm.debugInfo   = result.debugInfo;

          // Mantém totalEquipes vindo de equipes (se já carregou)
          vm.kpis.totalEquipes = vm.totalEquipes;

          vm.loadingInc = false;
          vm.lastUpdate = new Date();
          vm.refreshing = false;
        })
        .catch(function (err) {
          console.error('[Ctrl] Erro incidências:', err);
          vm.errorInc = extractErrorMsg(err);
          vm.loadingInc = false;
          vm.hasError = true;
          vm.refreshing = false;

          if (err.status === 401) {
            console.warn('[Ctrl] 401 — token expirado, retry em 10 s...');
            $timeout(loadIncidencias, 10000);
          }
        });
    }

    // ── Equipes ──────────────────────────────────────────

    function loadEquipes() {
      vm.loadingEq = true;
      vm.errorEq = null;

      console.log('[Ctrl] Buscando equipes para polo=' + vm.selectedPolo + '...');

      Api.getEquipes(vm.selectedPolo)
        .then(function (rawList) {
          // Delega mapeamento + filtro 2º recurso
          var result         = Proc.processEquipes(rawList);
          vm.equipes         = result.equipes;
          vm.equipes2Recurso = result.equipes2Recurso;
          vm.totalEquipes    = result.totalEquipes;
          vm.totalEquipes2   = result.totalEquipes2;

          vm.kpis.totalEquipes = vm.totalEquipes;
          vm.loadingEq = false;
        })
        .catch(function (err) {
          console.error('[Ctrl] Erro equipes:', err);
          vm.errorEq = extractErrorMsg(err);
          vm.loadingEq = false;

          if (err.status === 401) {
            $timeout(loadEquipes, 10000);
          }
        });
    }

    // ── Debug ────────────────────────────────────────────

    function testDebug() {
      vm.debugResult = 'Carregando...';
      Api.getDebug(vm.selectedPolo)
        .then(function (data) {
          vm.debugResult = JSON.stringify(data, null, 2);
        })
        .catch(function (err) {
          vm.debugResult = 'Erro: ' + (err.message || JSON.stringify(err));
        });
    }

    // ── Helper privado ───────────────────────────────────

    function extractErrorMsg(err) {
      if (err.data && err.data.error) return err.data.error;
      if (err.statusText) return err.statusText;
      if (err.message) return err.message;
      return 'Erro de conexão com o servidor';
    }
  }

})();
