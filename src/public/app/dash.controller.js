/**
 * NorthRadar – Dashboard Controller (thin)
 *
 * Responsável APENAS por:
 * - Inicializar estado do view-model
 * - Ligar métodos públicos ao template
 * - Delegar para DashApi (HTTP) e DashProcessor (lógica)
 * - Orquestrar o ciclo de vida (init, refresh, retry)
 * - Popup universal (abrir/fechar com contexto dinâmico)
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .controller('DashCtrl', [
      '$scope', '$interval', '$timeout', '$q', '$http',
      'DashApi', 'DashProcessor', 'DashHelpers',
      DashCtrl
    ]);

  function DashCtrl($scope, $interval, $timeout, $q, $http, Api, Proc, Helpers) {
    var vm = this;

    // ── View-model state ─────────────────────────────────
    vm.polos          = ['TODOS', 'ATLANTICO', 'DECEN', 'DNORT'];
    vm.selectedPolo   = loadPolo();
    vm.loadingInc     = true;
    vm.loadingEq      = true;
    vm.errorInc       = null;
    vm.errorEq        = null;
    vm.hasError       = false;
    vm.refreshing     = false;
    vm.lastUpdate     = null;
    vm.authReady      = false;
    vm.authStatus     = 'Verificando autenticação...';

    // ── Sort state per table ─────────────────────────────
    vm.sort = {
      panorama:  { field: '', reverse: false },
      top10Chi:  { field: '', reverse: false },
      top10Tma:  { field: '', reverse: false },
      top10Cli:  { field: '', reverse: false },
      equipes:   { field: '', reverse: false },
      equipes2:  { field: '', reverse: false },
      desl:      { field: '', reverse: false },
      popup:     { field: '', reverse: false }
    };

    // ── View-model data ──────────────────────────────────
    vm.rawIncidencias        = [];
    vm.clientesPorIncidencia = {};
    vm.panorama              = [];
    vm.totals                = {};
    vm.kpis                  = { totalIncidencias: 0, totalClientes: 0, totalEquipes: 0, naoDespachados: 0, urgentes: 0, eletrodependentes: 0, totalChi: 0 };
    vm.top10Chi              = [];
    vm.top10Tma              = [];
    vm.top10Cli              = [];
    vm.equipes               = [];
    vm.equipes2Recurso       = [];
    vm.totalEquipes          = 0;
    vm.totalEquipes2         = 0;
    vm.deslocamentos         = { items: [], total: 0, lastUpdated: null };
    vm.loadingDesl           = false;
    vm.errorDesl             = null;
    vm.poloChanging          = false;
    vm.debugInfo             = {};
    vm.showDebug             = false;
    vm.debugResult           = null;

    // ── Popup state ──────────────────────────────────────
    vm.popup = {
      visible: false,
      titulo: '',
      contextoCampo: '',
      dados: [],
      colunasContexto: []
    };

    // ── Expanded cell state ──────────────────────────────
    vm.expandedCell = { visible: false, label: '', value: '', top: 0, left: 0 };

    // ── Analytics view state ─────────────────────────────
    var VIEW_KEY = 'northradar_view';
    vm.currentView = loadView();
    vm.switchView  = switchView;
    var _chartInstances = {};

    // ── Unified component drag-and-drop ─────────────────
    var THEME_KEY   = 'northradar_theme';
    var POLO_KEY    = 'northradar_polo';
    var OP_ORDER_KEY = 'northradar_op_order';
    var AN_ORDER_KEY = 'northradar_an_order';

    var defaultOpOrder = [
      'op-kpi', 'op-top10chi', 'op-top10tma', 'op-top10cli',
      'op-panorama', 'op-equipes', 'op-equipes2', 'op-desl'
    ];
    var defaultAnOrder = [
      'an-kpi',
      'an-duracao', 'an-despacho',
      'an-top10chi', 'an-clientesConj',
      'an-top10cli', 'an-top10tma',
      'an-equipesConj', 'an-ocupacao',
      'an-extrasConj', 'an-polo',
      'an-atividade',
      'an-criticos', 'an-riskConj',
      'an-avisos', 'an-produtividade',
      'an-panorama'
    ];

    vm.opOrder = _loadOrder(OP_ORDER_KEY, defaultOpOrder);
    vm.anOrder = _loadOrder(AN_ORDER_KEY, defaultAnOrder);
    vm.draggingComp = null;

    // ── Dark mode ────────────────────────────────────────
    vm.darkMode = loadTheme();
    vm.toggleTheme = toggleTheme;
    // Sync DOM attribute on controller init (ensures both html & body have it)
    (function() {
      var t = vm.darkMode ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
      document.body.setAttribute('data-theme', t);
    })();

    // ── Custom dropdown ──────────────────────────────────
    vm.dropdownOpen = false;
    vm.toggleDropdown = toggleDropdown;
    vm.selectPolo = selectPolo;

    // ── Public bindings ──────────────────────────────────
    vm.changePolo     = changePolo;
    vm.formatDateTime = Helpers.formatDateTime;
    vm.toggleDebug    = function () { vm.showDebug = !vm.showDebug; };
    vm.testDebug      = testDebug;
    vm.abrirPopup     = abrirPopup;
    vm.fecharPopup    = fecharPopup;
    vm.togglePopupFiltroAtivo = togglePopupFiltroAtivo;
    vm.scrollToComp   = scrollToComp;
    vm.sortBy         = sortBy;
    vm.expandCell     = expandCell;
    vm.closeExpandedCell = closeExpandedCell;
    vm.onCompDragStart = onCompDragStart;
    vm.onCompDragOver  = onCompDragOver;
    vm.onCompDragLeave = onCompDragLeave;
    vm.onCompDrop      = onCompDrop;
    vm.onCompDragEnd   = onCompDragEnd;
    vm.getCompOrder    = getCompOrder;
    vm.startShare      = startShare;
    vm.cancelShare     = cancelShare;
    vm.isSharing       = false;
    vm.shareMode       = false;

    // ── Bootstrap ────────────────────────────────────────
    // Busca o intervalo de refresh configurado no servidor (.env → DASHBOARD_REFRESH_INTERVAL_MINUTES)
    $http.get('/api/config')
      .then(function (res) {
        var ms = (res.data && res.data.dashboardRefreshIntervalMs) || 900000;
        $interval(loadAll, ms);
      })
      .catch(function () {
        $interval(loadAll, 900000); // fallback 15 min
      });
    checkAuthAndLoad();

    // If persisted view was analytics, build charts after data loads
    if (vm.currentView === 'analytics') {
      $timeout(buildAllCharts, 500);
    }

    // ═══════════════════════════════════════════════════════
    // UNIFIED COMPONENT DRAG-AND-DROP
    // ═══════════════════════════════════════════════════════

    function _loadOrder(key, defaults) {
      try {
        var saved = localStorage.getItem(key);
        if (saved) {
          var parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length === defaults.length) {
            // Validate all expected IDs are present
            var valid = defaults.every(function (id) { return parsed.indexOf(id) >= 0; });
            if (valid) return parsed;
          }
        }
      } catch (e) { /* ignore */ }
      return defaults.slice();
    }

    function _saveOrder(key, order) {
      try { localStorage.setItem(key, JSON.stringify(order)); }
      catch (e) { /* ignore */ }
    }

    function getCompOrder(compId) {
      var arr = compId.indexOf('op-') === 0 ? vm.opOrder : vm.anOrder;
      var idx = arr.indexOf(compId);
      return { order: idx >= 0 ? idx + 1 : 99 };
    }

    function _findDragItem(el) {
      while (el && !el.classList.contains('drag-item')) {
        el = el.parentElement;
      }
      return el;
    }

    // Só permite arrastar se o mousedown foi no drag-handle
    vm._dragFromHandle = false;
    document.addEventListener('mousedown', function (e) {
      var el = e.target;
      while (el) {
        if (el.classList && el.classList.contains('drag-handle')) {
          vm._dragFromHandle = true;
          return;
        }
        el = el.parentElement;
      }
      vm._dragFromHandle = false;
    });

    function onCompDragStart($event, compId) {
      if (!vm._dragFromHandle) {
        $event.preventDefault();
        return;
      }
      vm._dragFromHandle = false;
      vm.draggingComp = compId;
      $event.dataTransfer.effectAllowed = 'move';
      $event.dataTransfer.setData('text/plain', compId);
      var target = _findDragItem($event.target);
      if (target) target.classList.add('dragging');
    }

    function onCompDragOver($event) {
      $event.preventDefault();
      $event.dataTransfer.dropEffect = 'move';
      var target = _findDragItem($event.target);
      if (target && target.dataset.compId !== vm.draggingComp) {
        target.classList.add('drag-over');
      }
    }

    function onCompDragLeave($event) {
      var target = _findDragItem($event.target);
      if (target) target.classList.remove('drag-over');
    }

    function onCompDrop($event, targetId) {
      $event.preventDefault();
      var sourceId = vm.draggingComp;
      // Remove visual states
      var allItems = document.querySelectorAll('.drag-item');
      for (var i = 0; i < allItems.length; i++) {
        allItems[i].classList.remove('drag-over', 'dragging');
      }
      if (sourceId && sourceId !== targetId) {
        var isOp = sourceId.indexOf('op-') === 0;
        var arr = isOp ? vm.opOrder : vm.anOrder;
        var key = isOp ? OP_ORDER_KEY : AN_ORDER_KEY;
        var srcIdx = arr.indexOf(sourceId);
        var tgtIdx = arr.indexOf(targetId);
        if (srcIdx >= 0 && tgtIdx >= 0) {
          arr.splice(srcIdx, 1);
          arr.splice(tgtIdx, 0, sourceId);
          _saveOrder(key, arr);
        }
      }
      vm.draggingComp = null;
    }

    function onCompDragEnd() {
      vm.draggingComp = null;
      vm._dragFromHandle = false;
      var allItems = document.querySelectorAll('.drag-item');
      for (var i = 0; i < allItems.length; i++) {
        allItems[i].classList.remove('drag-over', 'dragging');
      }
    }

    // ── Theme persistence ────────────────────────────────
    function loadTheme() {
      try {
        return localStorage.getItem(THEME_KEY) === 'dark';
      } catch (e) { return false; }
    }

    function toggleTheme() {
      vm.darkMode = !vm.darkMode;
      var theme = vm.darkMode ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);
      try { localStorage.setItem(THEME_KEY, theme); }
      catch (e) { /* ignore */ }

      // Force repaint so inline styles using CSS variables get recalculated
      document.body.style.display = 'none';
      /* jshint -W030 */ document.body.offsetHeight; /* jshint +W030 */
      document.body.style.display = '';

      // Rebuild Chart.js charts (canvas colors are baked at render time)
      if (vm.currentView === 'analytics') {
        $timeout(buildAllCharts, 80);
      }
    }

    // ── Custom dropdown ──────────────────────────────────
    function toggleDropdown($event) {
      $event.stopPropagation();
      vm.dropdownOpen = !vm.dropdownOpen;
      if (vm.dropdownOpen) {
        var closeHandler = function () {
          $timeout(function () { vm.dropdownOpen = false; });
          document.removeEventListener('click', closeHandler, true);
        };
        setTimeout(function () {
          document.addEventListener('click', closeHandler, true);
        }, 0);
      }
    }

    function selectPolo(polo) {
      var isNewPolo = polo !== vm.selectedPolo;
      vm.selectedPolo = polo;
      vm.dropdownOpen = false;
      savePolo(polo);
      if (isNewPolo) {
        vm.poloChanging = true;
      }
      loadAll();
    }

    // ═══════════════════════════════════════════════════════
    // ANALYTICS VIEW — ROUTE SWITCHING & CHARTS
    // ═══════════════════════════════════════════════════════

    function switchView(view) {
      vm.currentView = view;
      saveView(view);
      if (view === 'analytics') {
        $timeout(buildAllCharts, 150);
      }
    }

    function loadView() {
      try {
        var v = localStorage.getItem(VIEW_KEY);
        if (v === 'analytics' || v === 'operational') return v;
      } catch (e) { /* ignore */ }
      return 'operational';
    }

    function saveView(v) {
      try { localStorage.setItem(VIEW_KEY, v); }
      catch (e) { /* ignore */ }
    }

    /** Destroy an existing Chart.js instance by key */
    function _destroyChart(key) {
      if (_chartInstances[key]) {
        _chartInstances[key].destroy();
        _chartInstances[key] = null;
      }
    }

    /** Create or recreate a chart */
    function _makeChart(canvasId, key, config) {
      _destroyChart(key);
      var el = document.getElementById(canvasId);
      if (!el) return;
      _chartInstances[key] = new Chart(el.getContext('2d'), config);
    }

    /**
     * Generic chart onClick handler — resolves clicked element
     * and calls vm.abrirPopup with the mapped context.
     *
     * @param {string} chartKey - key of the _chartInstances entry
     * @param {Array}  contextMap - array of { tipo, campo, valor } per data index
     * @param {Event}  event - Chart.js event
     * @param {Array}  elements - active elements from Chart.js
     */
    function _onChartClick(chartKey, contextMap, event, elements) {
      if (!elements || elements.length === 0) return;
      var idx = elements[0].index;
      var ctx = contextMap[idx];
      if (!ctx) return;
      $timeout(function () {
        vm.abrirPopup(ctx.tipo, ctx.campo, ctx.valor);
      });
    }

    /** Enel palette for chart segments */
    var _palette = [
      '#003DA5', '#E4002B', '#78BE20', '#ED8B00',
      '#00A3E0', '#6D2077', '#C4D600', '#FF6F61',
      '#00B2A9', '#B0B7BC', '#5C068C', '#FF9E1B'
    ];
    var _paletteDark = [
      '#3B7DDB', '#FF5C7A', '#A3E05A', '#FFB347',
      '#4DC9F6', '#9B59B6', '#D4E157', '#FF8A80',
      '#4DD0C8', '#CFD8DC', '#AB47BC', '#FFCC80'
    ];

    function _isDark() { return vm.darkMode; }

    function _chartColors(count) {
      var pal = _isDark() ? _paletteDark : _palette;
      var colors = [];
      for (var i = 0; i < count; i++) colors.push(pal[i % pal.length]);
      return colors;
    }

    function _textColor() { return _isDark() ? '#e0e0e0' : '#333'; }
    function _gridColor() { return _isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }

    function _baseOptions(title) {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: !!title, text: title || '', color: _textColor(), font: { size: 13, weight: '600' } },
          legend: { labels: { color: _textColor(), font: { size: 11 }, boxWidth: 14, padding: 12 } },
          tooltip: { cornerRadius: 10, padding: 10 }
        }
      };
    }

    /** Build ALL analytics charts from current vm data */
    function buildAllCharts() {
      if (vm.currentView !== 'analytics') return;
      if (!vm.totals || !vm.panorama) return;

      _buildChartDuracao();
      _buildChartDespacho();
      _buildChartTop10Chi();
      _buildChartClientesConj();
      _buildChartTop10Cli();
      _buildChartTop10Tma();
      _buildChartEquipesConj();
      _buildChartOcupacao();
      _buildChartExtrasConj();
      _buildChartPolo();
      _buildChartAtividade();
      _buildChartCriticos();
      _buildChartRiskConj();
      _buildChartAvisos();
      _buildChartProdutividade();
      _buildChartPanorama();
    }

    // 1) Doughnut — Time distribution
    function _buildChartDuracao() {
      var t = vm.totals || {};
      var data = [t.lt8h || 0, t.h8_16 || 0, t.h16_24 || 0, t.h24_48 || 0, t.gt48h || 0];
      var labels = ['< 8h', '8h – 16h', '16h – 24h', '24h – 48h', '> 48h'];
      var campos = ['lt8h', 'h8_16', 'h16_24', 'h24_48', 'gt48h'];
      var colors = ['#78BE20', '#00A3E0', '#ED8B00', '#E4002B', '#6D2077'];
      var ctxMap = campos.map(function (c) { return { tipo: 'card', campo: c }; });

      _makeChart('chartDuracao', 'duracao', {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
        options: angular.merge({}, _baseOptions(), {
          cutout: '60%',
          onClick: function (evt, els) { _onChartClick('duracao', ctxMap, evt, els); },
          plugins: {
            legend: { position: 'right', labels: { color: _textColor(), padding: 14 } }
          }
        })
      });
    }

    // 2) Doughnut — Dispatch status
    function _buildChartDespacho() {
      var k = vm.kpis || {};
      var desp = (k.totalIncidencias || 0) - (k.naoDespachados || 0);
      var data = [desp, k.naoDespachados || 0];
      var labels = ['Despachadas', 'Não Despachadas'];
      var colors = ['#78BE20', '#E4002B'];
      var ctxMap = [
        { tipo: 'card', campo: 'totalIncidencias' },
        { tipo: 'card', campo: 'naoDespachados' }
      ];

      _makeChart('chartDespacho', 'despacho', {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
        options: angular.merge({}, _baseOptions(), {
          cutout: '60%',
          onClick: function (evt, els) { _onChartClick('despacho', ctxMap, evt, els); },
          plugins: {
            legend: { position: 'right', labels: { color: _textColor(), padding: 14 } }
          }
        })
      });
    }

    // 3) Horizontal bar — Top 10 CHI
    function _buildChartTop10Chi() {
      var list = (vm.top10Chi || []).slice(0, 10);
      var labels = list.map(function (r) { return r.incidencia || '—'; });
      var data = list.map(function (r) { return r.chi || 0; });
      var colors = _chartColors(list.length);
      var ctxMap = list.map(function (r) { return { tipo: 'top10', campo: 'chi', valor: r.incidencia }; });

      _makeChart('chartTop10Chi', 'top10Chi', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'CHI', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('top10Chi', ctxMap, evt, els); },
          layout: { padding: { left: 20 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 12, weight: '600' }, padding: 8, autoSkip: false } }
          }
        })
      });
    }

    // 4) Bar — Clientes afetados por conjunto (top 10)
    function _buildChartClientesConj() {
      var sorted = (vm.panorama || []).slice().sort(function (a, b) { return (b.clientesAfetados || 0) - (a.clientesAfetados || 0); });
      var top10 = sorted.slice(0, 10);
      var labels = top10.map(function (r) { return r.conjunto || '—'; });
      var data = top10.map(function (r) { return r.clientesAfetados || 0; });
      var colors = _chartColors(top10.length);
      var ctxMap = top10.map(function (r) { return { tipo: 'panorama', campo: 'clientesAfetados', valor: r.conjunto }; });

      _makeChart('chartClientesConj', 'clientesConj', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Clientes', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('clientesConj', ctxMap, evt, els); },
          plugins: { legend: { display: false } },
          scales: {
            y: { grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 10 }, maxRotation: 45 } }
          }
        })
      });
    }

    // 5) Bar — Ocupação (Inc / Equipe) por conjunto
    function _buildChartOcupacao() {
      var filtered = (vm.panorama || []).filter(function (r) { return r.equipes > 0; });
      filtered.sort(function (a, b) { return (b.incPorEquipe || 0) - (a.incPorEquipe || 0); });
      var top = filtered.slice(0, 10);
      var labels = top.map(function (r) { return r.conjunto || '—'; });
      var dataInc = top.map(function (r) { return r.incidenciasAtivas || 0; });
      var dataEq = top.map(function (r) { return r.equipes || 0; });
      var ctxMap = top.map(function (r) { return { tipo: 'panorama', campo: 'incidenciasAtivas', valor: r.conjunto }; });

      _makeChart('chartOcupacao', 'ocupacao', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Incidências', data: dataInc, backgroundColor: _isDark() ? '#FF5C7A' : '#E4002B', borderRadius: 6, borderSkipped: false },
            { label: 'Equipes', data: dataEq, backgroundColor: _isDark() ? '#A3E05A' : '#78BE20', borderRadius: 6, borderSkipped: false }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('ocupacao', ctxMap, evt, els); },
          scales: {
            y: { grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 10 }, maxRotation: 45 } }
          }
        })
      });
    }

    // 6) Bar — Indicadores críticos
    function _buildChartCriticos() {
      var k = vm.kpis || {};
      var labels = ['Urgentes', 'Eletrodep.', 'N/Despachados'];
      var data = [k.urgentes || 0, k.eletrodependentes || 0, k.naoDespachados || 0];
      var colors = ['#E4002B', '#6D2077', '#ED8B00'];
      var ctxMap = [
        { tipo: 'card', campo: 'urgente' },
        { tipo: 'card', campo: 'eletrodependente' },
        { tipo: 'card', campo: 'naoDespachados' }
      ];

      _makeChart('chartCriticos', 'criticos', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Quantidade', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('criticos', ctxMap, evt, els); },
          plugins: { legend: { display: false } },
          scales: {
            y: { grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: _textColor() } }
          }
        })
      });
    }

    // 7) Horizontal bar — Top 10 Clientes Afetados por incidência
    function _buildChartTop10Cli() {
      var list = (vm.top10Cli || []).slice(0, 10);
      var labels = list.map(function (r) { return r.incidencia || '—'; });
      var data = list.map(function (r) { return r.cli || 0; });
      var colors = _chartColors(list.length);
      var ctxMap = list.map(function (r) { return { tipo: 'top10', campo: 'cli', valor: r.incidencia }; });

      _makeChart('chartTop10Cli', 'top10Cli', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Clientes', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('top10Cli', ctxMap, evt, els); },
          layout: { padding: { left: 20 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 12, weight: '600' }, padding: 8, autoSkip: false } }
          }
        })
      });
    }

    // 8) Horizontal bar — Top 10 TMA
    function _buildChartTop10Tma() {
      var list = (vm.top10Tma || []).slice(0, 10);
      var labels = list.map(function (r) { return r.incidencia || '—'; });
      var data = list.map(function (r) { return r.tma || 0; });
      var colors = _chartColors(list.length);
      var ctxMap = list.map(function (r) { return { tipo: 'top10', campo: 'tma', valor: r.incidencia }; });

      _makeChart('chartTop10Tma', 'top10Tma', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'TMA (min)', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('top10Tma', ctxMap, evt, els); },
          layout: { padding: { left: 20 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 12, weight: '600' }, padding: 8, autoSkip: false } }
          }
        })
      });
    }

    // 9) Stacked bar — Equipes Turno vs Extras por Conjunto
    function _buildChartEquipesConj() {
      var sorted = (vm.panorama || []).slice()
        .filter(function (r) { return r.equipes > 0 || r.qtt2Rec > 0; })
        .sort(function (a, b) { return (b.equipes + b.qtt2Rec) - (a.equipes + a.qtt2Rec); });
      var top = sorted.slice(0, 12);
      var labels = top.map(function (r) { return r.conjunto || '—'; });
      var dataTurno = top.map(function (r) { return Math.max(0, (r.equipes || 0) - (r.qtt2Rec || 0)); });
      var dataExtras = top.map(function (r) { return r.qtt2Rec || 0; });
      var ctxMap = top.map(function (r) { return { tipo: 'panorama', campo: 'equipes', valor: r.conjunto }; });

      _makeChart('chartEquipesConj', 'equipesConj', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Equipes Turno', data: dataTurno, backgroundColor: _isDark() ? '#A3E05A' : '#78BE20', borderRadius: 4, borderSkipped: false },
            { label: 'Equipes Extras', data: dataExtras, backgroundColor: _isDark() ? '#FFB347' : '#ED8B00', borderRadius: 4, borderSkipped: false }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('equipesConj', ctxMap, evt, els); },
          scales: {
            y: { stacked: true, grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { stacked: true, grid: { display: false }, ticks: { color: _textColor(), font: { size: 10 }, maxRotation: 45 } }
          }
        })
      });
    }

    // 10) Horizontal bar — Equipes Extras por Conjunto
    function _buildChartExtrasConj() {
      var filtered = (vm.panorama || []).filter(function (r) { return r.qtt2Rec > 0; });
      filtered.sort(function (a, b) { return (b.qtt2Rec || 0) - (a.qtt2Rec || 0); });
      var top = filtered.slice(0, 12);
      var labels = top.map(function (r) { return r.conjunto || '—'; });
      var data = top.map(function (r) { return r.qtt2Rec || 0; });
      var ctxMap = top.map(function (r) { return { tipo: 'panorama', campo: 'qtt2Rec', valor: r.conjunto }; });

      _makeChart('chartExtrasConj', 'extrasConj', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Equipes Extras', data: data, backgroundColor: _isDark() ? '#FFB347' : '#ED8B00', borderRadius: 6, borderSkipped: false },
            { label: 'Incidências', data: top.map(function (r) { return r.incidenciasAtivas || 0; }), backgroundColor: _isDark() ? '#FF5C7A' : '#E4002B', borderRadius: 6, borderSkipped: false }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('extrasConj', ctxMap, evt, els); },
          layout: { padding: { left: 20 } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 12, weight: '600' }, padding: 8, autoSkip: false } }
          }
        })
      });
    }

    // 11) Doughnut — Distribuição por Polo
    function _buildChartPolo() {
      var poloMap = {};
      (vm.panorama || []).forEach(function (r) {
        var polo = r.polo || 'N/A';
        if (!poloMap[polo]) poloMap[polo] = { inc: 0, cli: 0, eq: 0 };
        poloMap[polo].inc += r.incidenciasAtivas || 0;
        poloMap[polo].cli += r.clientesAfetados || 0;
        poloMap[polo].eq += r.equipes || 0;
      });
      var keys = Object.keys(poloMap);
      var labels = keys;
      var dataInc = keys.map(function (k) { return poloMap[k].inc; });
      var dataCli = keys.map(function (k) { return poloMap[k].cli; });
      var dataEq = keys.map(function (k) { return poloMap[k].eq; });
      var colors = _chartColors(keys.length);
      // Polo doughnut click → show all incidences (no specific filter granularity)
      var ctxMap = keys.map(function () { return { tipo: 'card', campo: 'totalIncidencias' }; });

      _makeChart('chartPolo', 'polo', {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [
            { label: 'Incidências', data: dataInc, backgroundColor: colors, borderWidth: 2, borderColor: _isDark() ? '#1e1e1e' : '#fff', hoverOffset: 8 }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          cutout: '55%',
          onClick: function (evt, els) { _onChartClick('polo', ctxMap, evt, els); },
          plugins: {
            legend: { position: 'right', labels: { color: _textColor(), padding: 14 } },
            tooltip: {
              callbacks: {
                afterLabel: function (ctx) {
                  var i = ctx.dataIndex;
                  return 'Clientes: ' + dataCli[i] + '\nEquipes: ' + dataEq[i];
                }
              }
            }
          }
        })
      });
    }

    // 12) Stacked bar — Atividade das equipes
    function _buildChartAtividade() {
      var list = (vm.equipes || []).slice();
      if (list.length === 0) return;
      list.sort(function (a, b) {
        return ((b.atribuidas || 0) + (b.improdutivas || 0) + (b.emergenciais || 0) + (b.comerciais || 0))
             - ((a.atribuidas || 0) + (a.improdutivas || 0) + (a.emergenciais || 0) + (a.comerciais || 0));
      });
      var top = list.slice(0, 20);
      var labels = top.map(function (eq) { return eq.nome || '—'; });
      var ctxMap = top.map(function (eq) { return { tipo: 'equipe', campo: 'equipes', valor: eq.nome }; });

      _makeChart('chartAtividade', 'atividade', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Atribuídas', data: top.map(function (eq) { return eq.atribuidas || 0; }), backgroundColor: _isDark() ? '#3B7DDB' : '#003DA5', borderRadius: 3, borderSkipped: false },
            { label: 'Emergenciais', data: top.map(function (eq) { return eq.emergenciais || 0; }), backgroundColor: _isDark() ? '#FF5C7A' : '#E4002B', borderRadius: 3, borderSkipped: false },
            { label: 'Improdutivas', data: top.map(function (eq) { return eq.improdutivas || 0; }), backgroundColor: _isDark() ? '#FFB347' : '#ED8B00', borderRadius: 3, borderSkipped: false },
            { label: 'Comerciais', data: top.map(function (eq) { return eq.comerciais || 0; }), backgroundColor: _isDark() ? '#A3E05A' : '#78BE20', borderRadius: 3, borderSkipped: false }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('atividade', ctxMap, evt, els); },
          scales: {
            y: { stacked: true, grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { stacked: true, grid: { display: false }, ticks: { color: _textColor(), font: { size: 9 }, maxRotation: 60 } }
          }
        })
      });
    }

    // 13) Grouped bar — Não Desp / Essenciais / Eletrodep por Conjunto
    function _buildChartRiskConj() {
      var filtered = (vm.panorama || []).filter(function (r) {
        return (r.naoDespachados || 0) > 0 || (r.clEssencial || 0) > 0 || (r.eletrodependente || 0) > 0;
      });
      filtered.sort(function (a, b) {
        return ((b.naoDespachados || 0) + (b.eletrodependente || 0)) - ((a.naoDespachados || 0) + (a.eletrodependente || 0));
      });
      var top = filtered.slice(0, 10);
      var labels = top.map(function (r) { return r.conjunto || '—'; });
      var ctxMap = top.map(function (r) { return { tipo: 'panorama', campo: 'naoDespachados', valor: r.conjunto }; });

      _makeChart('chartRiskConj', 'riskConj', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Não Despachados', data: top.map(function (r) { return r.naoDespachados || 0; }), backgroundColor: _isDark() ? '#FFB347' : '#ED8B00', borderRadius: 4, borderSkipped: false },
            { label: 'Cl. Essenciais', data: top.map(function (r) { return r.clEssencial || 0; }), backgroundColor: _isDark() ? '#4DC9F6' : '#00A3E0', borderRadius: 4, borderSkipped: false },
            { label: 'Cl. Críticos', data: top.map(function (r) { return r.eletrodependente || 0; }), backgroundColor: _isDark() ? '#AB47BC' : '#6D2077', borderRadius: 4, borderSkipped: false }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('riskConj', ctxMap, evt, els); },
          scales: {
            y: { grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 10 }, maxRotation: 45 } }
          }
        })
      });
    }

    // 14) Bar — Avisos por Conjunto (Top 10)
    function _buildChartAvisos() {
      var filtered = (vm.panorama || []).filter(function (r) { return (r.qttAvisos || 0) > 0; });
      filtered.sort(function (a, b) { return (b.qttAvisos || 0) - (a.qttAvisos || 0); });
      var top = filtered.slice(0, 10);
      var labels = top.map(function (r) { return r.conjunto || '—'; });
      var data = top.map(function (r) { return r.qttAvisos || 0; });
      var ctxMap = top.map(function (r) { return { tipo: 'panorama', campo: 'qttAvisos', valor: r.conjunto }; });

      _makeChart('chartAvisos', 'avisos', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Avisos', data: data, backgroundColor: _isDark() ? '#FF5C7A' : '#E4002B', borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('avisos', ctxMap, evt, els); },
          plugins: { legend: { display: false } },
          scales: {
            y: { grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 10 }, maxRotation: 45 } }
          }
        })
      });
    }

    // 15) Horizontal bar — Produtividade por Equipe (Top 15)
    function _buildChartProdutividade() {
      var list = (vm.equipes || []).slice()
        .filter(function (eq) { return (eq.produtividadeHora || 0) > 0; });
      if (list.length === 0) return;
      list.sort(function (a, b) { return (b.produtividadeHora || 0) - (a.produtividadeHora || 0); });
      var top = list.slice(0, 15);
      var labels = top.map(function (eq) { return eq.nome || '—'; });
      var data = top.map(function (eq) { return eq.produtividadeHora || 0; });
      var colors = _chartColors(top.length);
      var ctxMap = top.map(function (eq) { return { tipo: 'equipe', campo: 'equipes', valor: eq.nome }; });

      _makeChart('chartProdutividade', 'produtividade', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Prod./h', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('produtividade', ctxMap, evt, els); },
          layout: { padding: { left: 20 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 12, weight: '600' }, padding: 8, autoSkip: false } }
          }
        })
      });
    }

    // 16) Stacked bar — Full panorama overview
    function _buildChartPanorama() {
      var sorted = (vm.panorama || []).slice().sort(function (a, b) { return (b.clientesAfetados || 0) - (a.clientesAfetados || 0); });
      var top = sorted.slice(0, 12);
      var labels = top.map(function (r) { return r.conjunto || '—'; });
      var ctxMap = top.map(function (r) { return { tipo: 'panorama', campo: 'conjunto', valor: r.conjunto }; });

      _makeChart('chartPanorama', 'panorama', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Clientes Afetados', data: top.map(function (r) { return r.clientesAfetados || 0; }), backgroundColor: _isDark() ? '#3B7DDB' : '#003DA5', borderRadius: 4, borderSkipped: false },
            { label: 'CHI', data: top.map(function (r) { return r.chi || 0; }), backgroundColor: _isDark() ? '#FF5C7A' : '#E4002B', borderRadius: 4, borderSkipped: false },
            { label: 'Incidências', data: top.map(function (r) { return r.incidenciasAtivas || 0; }), backgroundColor: _isDark() ? '#A3E05A' : '#78BE20', borderRadius: 4, borderSkipped: false },
            { label: 'Equipes', data: top.map(function (r) { return r.equipes || 0; }), backgroundColor: _isDark() ? '#FFB347' : '#ED8B00', borderRadius: 4, borderSkipped: false }
          ]
        },
        options: angular.merge({}, _baseOptions(), {
          onClick: function (evt, els) { _onChartClick('panorama', ctxMap, evt, els); },
          scales: {
            y: { stacked: false, grid: { color: _gridColor() }, ticks: { color: _textColor() }, beginAtZero: true },
            x: { stacked: false, grid: { display: false }, ticks: { color: _textColor(), font: { size: 10 }, maxRotation: 45 } }
          }
        })
      });
    }

    // ═══════════════════════════════════════════════════════
    // ORCHESTRATION
    // ═══════════════════════════════════════════════════════

    function changePolo(polo) {
      vm.selectedPolo = polo;
      savePolo(polo);
      loadAll();
    }

    /** Quando todos os loaders terminam após uma troca de polo, desliga a flag. */
    function _checkPoloChangeDone() {
      if (vm.poloChanging && !vm.loadingInc && !vm.loadingEq && !vm.loadingDesl) {
        vm.poloChanging = false;
      }
    }

    /**
     * Enriquece cada item de uma lista top10 com contagens de equipes
     * cruzando pelo campo `incidencia` (= ORDEM no Spotfire):
     *   eqAtrib — qtd de equipes distintas com campo `despachado` preenchido
     *   eqDesl  — qtd de equipes distintas com campo `aCaminho` preenchido
     */
    function _enrichTop10ComDeslocamentos(top10List, deslItems) {
      // Indexa deslocamentos M300 por ORDEM (= número da incidência)
      var byOrdem = {};
      (deslItems || []).forEach(function (d) {
        var key = String(d.ordem || '').trim();
        if (!key || key === '—' || key === '-') return;
        if (!byOrdem[key]) byOrdem[key] = [];
        byOrdem[key].push(d);
      });

      top10List.forEach(function (r) {
        var key = String(r.incidencia || '').trim();
        var matches = byOrdem[key] || [];

        // Sets chaveados por nome normalizado (UPPER) para deduplicação entre fontes
        var atrib = {};
        var desl  = {};

        // --- Fonte 1: Oper View (1ª equipe de cada status) ---
        if (r.operviewAtribuida) {
          atrib[r.operviewAtribuida.toUpperCase()] = true;
        }
        if (r.operviewDeslocada) {
          var ovDKey = r.operviewDeslocada.toUpperCase();
          desl[ovDKey]  = true;
          atrib[ovDKey] = true; // deslocada implica atribuída
        }

        // --- Fonte 2: M300 deslocamentos (equipes subsequentes) ---
        matches.forEach(function (d) {
          var eq = (d.equipe || '').trim();
          if (!eq) return;
          var eqKey = eq.toUpperCase();
          if (d.despachado && d.despachado !== '—' && d.despachado !== '-') {
            atrib[eqKey] = true;
          }
          if (d.aCaminho && d.aCaminho !== '—' && d.aCaminho !== '-') {
            desl[eqKey]  = true;
            atrib[eqKey] = true; // a caminho implica atribuída
          }
        });

        r.eqAtrib = Object.keys(atrib).length;
        r.eqDesl  = Object.keys(desl).length;
      });
    }

    /** Aplica enriquecimento nas 3 listas top10 se ambos os dados estiverem disponíveis. */
    function _applyDeslEnrichment() {
      var deslItems = vm.deslocamentos ? vm.deslocamentos.items : [];
      if (!deslItems || !deslItems.length) return;
      if (vm.top10Chi.length) _enrichTop10ComDeslocamentos(vm.top10Chi, deslItems);
      if (vm.top10Tma.length) _enrichTop10ComDeslocamentos(vm.top10Tma, deslItems);
      if (vm.top10Cli.length) _enrichTop10ComDeslocamentos(vm.top10Cli, deslItems);
    }

    function loadPolo() {
      try {
        var saved = localStorage.getItem(POLO_KEY);
        if (saved && ['TODOS','ATLANTICO','DECEN','DNORT'].indexOf(saved) >= 0) return saved;
      } catch (e) { /* ignore */ }
      return 'TODOS';
    }

    function savePolo(polo) {
      try { localStorage.setItem(POLO_KEY, polo); }
      catch (e) { /* ignore */ }
    }

    /** Retorna o parâmetro 'polos' para a API: junta todos quando TODOS */
    function _getPoloParam() {
      if (vm.selectedPolo === 'TODOS') {
        return vm.polos.filter(function (p) { return p !== 'TODOS'; }).join(',');
      }
      return vm.selectedPolo;
    }

    function checkAuthAndLoad() {
      Api.getStatus()
        .then(function (s) {
          if (s.auth && s.auth.hasToken) {
            vm.authReady = true;
            vm.authStatus = 'Autenticado';
            console.log('[Ctrl] Auth OK — Token:', s.auth.tokenPreview);
            console.log('[Ctrl] API Base:', s.config.domainApi);

            // Configurar tags de equipes extras vindas do .env
            if (s.config && s.config.tagsEquipesExtras) {
              Proc.setTagsEquipesExtras(s.config.tagsEquipesExtras);
            }

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
      loadIncidenciasEClientesCriticos();
      loadEquipes();
      loadDeslocamentos();
    }

    // ── Deslocamentos ──────────────────────────────────
    // Contador de geração: garante que respostas atrasadas (de um polo
    // anterior) não sobrescrevam dados de uma requisição mais recente.
    var _deslGeneration = 0;

    function loadDeslocamentos() {
      vm.loadingDesl = true;
      vm.errorDesl = null;

      var poloParam = _getPoloParam();
      var generation = ++_deslGeneration;
      console.log('[Ctrl] Buscando deslocamentos para polos=' + poloParam + ' (gen=' + generation + ')...');

      Api.getDeslocamentos(poloParam)
        .then(function (data) {
          if (generation !== _deslGeneration) {
            console.log('[Ctrl] Deslocamentos gen=' + generation + ' descartados (polo já trocou)');
            return;
          }
          var newItems = data.items || [];
          // Durante auto-refresh mantém dados existentes se o servidor retornar
          // vazio (ex.: Spotfire re-inicializando). Troca apenas quando há dados
          // ou quando é uma mudança real de polo.
          if (!vm.poloChanging && newItems.length === 0 && vm.deslocamentos.items.length > 0) {
            console.log('[Ctrl] Deslocamentos: resposta vazia ignorada (auto-refresh, dados anteriores mantidos)');
            vm.loadingDesl = false;
            _checkPoloChangeDone();
            return;
          }
          vm.deslocamentos = {
            items:       newItems,
            total:       data.total       || 0,
            lastUpdated: data.lastUpdated || null
          };
          // Re-enriquecer top10 com novos dados de deslocamentos
          _applyDeslEnrichment();
          vm.loadingDesl = false;
          _checkPoloChangeDone();
          console.log('[Ctrl] Deslocamentos carregados: ' + vm.deslocamentos.total + ' itens');
        })
        .catch(function (err) {
          if (generation !== _deslGeneration) return;
          console.warn('[Ctrl] Deslocamentos indisponíveis para polo=' + poloParam + ':', err);
          vm.errorDesl = (err && (err.statusText || err.message)) || 'Indisponível';
          vm.loadingDesl = false;
          _checkPoloChangeDone();
        });
    }

    // ── Incidências + Clientes Críticos (paralelo) ──────

    function loadIncidenciasEClientesCriticos() {
      vm.loadingInc = true;
      vm.errorInc = null;

      console.log('[Ctrl] Buscando incidências + clientes críticos para polo=' + vm.selectedPolo + '...');

      var poloParam = _getPoloParam();

      $q.all({
        incidencias: Api.getIncidencias(poloParam),
        clientesCriticos: Api.getClientesCriticos(poloParam)
      }).then(function (results) {
        var items = results.incidencias || [];
        var clCriticos = results.clientesCriticos || [];

        vm.rawIncidencias = items;

        // Cruzar clientes críticos com incidências
        var cruzamento = Proc.cruzarClientesCriticos(clCriticos, items);
        vm.clientesPorIncidencia = cruzamento.clientesPorIncidencia;

        // Processar incidências com dados de eletrodep do cruzamento
        var result = Proc.processIncidencias(
          items,
          cruzamento.eletrodepPorConjunto,
          cruzamento.totalEletrodep,
          cruzamento.avisoPorConjunto
        );

        vm.panorama    = result.panorama;
        vm.totals      = result.totals;
        vm.kpis        = result.kpis;
        vm.top10Chi    = result.top10Chi;
        vm.top10Tma    = result.top10Tma;
        vm.top10Cli    = result.top10Cli;
        vm.debugInfo   = result.debugInfo;

        // Cruzar com deslocamentos para contar equipes atribuídas/deslocadas por incidência
        _applyDeslEnrichment();

        // Mantém totalEquipes vindo de equipes (se já carregou)
        vm.kpis.totalEquipes = vm.totalEquipes;

        vm.loadingInc = false;
        vm.lastUpdate = new Date();
        vm.refreshing = false;
        _checkPoloChangeDone();

        console.log('[Ctrl] Dados carregados. Eletrodep: ' + cruzamento.totalEletrodep +
                    ', Clientes críticos: ' + clCriticos.length);

        // Refresh analytics charts if view is active
        $timeout(buildAllCharts, 100);
      })
      .catch(function (err) {
        console.error('[Ctrl] Erro incidências/clientes:', err);
        vm.errorInc = extractErrorMsg(err);
        vm.loadingInc = false;
        vm.hasError = true;
        vm.refreshing = false;
        _checkPoloChangeDone();

        if (err.status === 401) {
          console.warn('[Ctrl] 401 — token expirado, retry em 10 s...');
          $timeout(loadIncidenciasEClientesCriticos, 10000);
        }
      });
    }

    // ── Equipes ──────────────────────────────────────────

    function loadEquipes() {
      vm.loadingEq = true;
      vm.errorEq = null;

      console.log('[Ctrl] Buscando equipes para polo=' + vm.selectedPolo + '...');

      Api.getEquipes(_getPoloParam())
        .then(function (rawList) {
          var result         = Proc.processEquipes(rawList);
          vm.equipes         = result.equipes;
          vm.equipes2Recurso = result.equipes2Recurso;
          vm.totalEquipes    = result.totalEquipes;
          vm.totalEquipes2   = result.totalEquipes2;

          vm.kpis.totalEquipes = vm.totalEquipes;
          vm.loadingEq = false;
          _checkPoloChangeDone();

          // Refresh equipe-dependent charts
          $timeout(buildAllCharts, 100);
        })
        .catch(function (err) {
          console.error('[Ctrl] Erro equipes:', err);
          vm.errorEq = extractErrorMsg(err);
          vm.loadingEq = false;
          _checkPoloChangeDone();

          if (err.status === 401) {
            $timeout(loadEquipes, 10000);
          }
        });
    }

    // ═══════════════════════════════════════════════════════
    // TABLE SORTING
    // ═══════════════════════════════════════════════════════

    /**
     * Toggle sort on a given table by field.
     * @param {string} table - key in vm.sort (e.g. 'panorama', 'top10Chi')
     * @param {string} field - property name to sort by
     */
    function sortBy(table, field) {
      var s = vm.sort[table];
      if (!s) return;
      if (s.field === field) {
        s.reverse = !s.reverse;
      } else {
        s.field = field;
        s.reverse = false;
      }
    }

    // ═══════════════════════════════════════════════════════
    // POPUP UNIVERSAL
    // ═══════════════════════════════════════════════════════

    /**
     * Abre popup com dados filtrados pelo contexto de clique.
     *
     * @param {string} tipo   - 'card' | 'panorama' | 'top10' | 'equipe'
     * @param {string} campo  - campo clicado (ex: 'urgente', 'eletrodependente', 'chi', etc)
     * @param {string} [valor] - filtro adicional (conjunto, numero, equipe)
     */
    function abrirPopup(tipo, campo, valor) {
      var contexto = { tipo: tipo, campo: campo, valor: valor || null };

      var dados = Proc.filtrarIncidenciasPorContexto(
        contexto,
        vm.rawIncidencias,
        vm.clientesPorIncidencia
      );

      var colunasContexto = _getColunasContexto(tipo, campo);

      // Contextos que exibem incidências encerradas e precisam do filtro "Somente ATIVO"
      var mostrarFiltroAtivo = (tipo === 'equipe') || (campo === 'desl');

      vm.popup = {
        visible: true,
        titulo: _getTituloPopup(tipo, campo, valor),
        contextoCampo: campo,
        dadosTodos: dados,
        dados: dados,
        colunasContexto: colunasContexto,
        mostrarFiltroAtivo: mostrarFiltroAtivo,
        filtroAtivo: false
      };

      // Reset popup sort on each open
      vm.sort.popup = { field: '', reverse: false };

      console.log('[Ctrl] Popup aberto: ' + tipo + '/' + campo + ' → ' + dados.length + ' registros');
    }

    function togglePopupFiltroAtivo() {
      if (vm.popup.filtroAtivo) {
        vm.popup.dados = (vm.popup.dadosTodos || []).filter(function (row) {
          return row.estado === 'ACTIVO' && (!row.dataFim || row.dataFim === '-');
        });
      } else {
        vm.popup.dados = vm.popup.dadosTodos;
      }
    }

    /**
     * Scroll to a component panel by data-comp-id.
     * If currently on analytics view, switches to operational first.
     */
    function scrollToComp(compId) {
      var needSwitch = vm.currentView !== 'operational' && compId.indexOf('op-') === 0;
      if (needSwitch) {
        vm.currentView = 'operational';
        localStorage.setItem('northradar_view', 'operational');
      }
      $timeout(function () {
        var el = document.querySelector('[data-comp-id="' + compId + '"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-flash');
          setTimeout(function () { el.classList.remove('highlight-flash'); }, 1500);
        }
      }, needSwitch ? 300 : 50);
    }

    /**
     * Enter share mode: show toast and listen for clicks on [data-comp-id].
     */
    function startShare() {
      if (vm.shareMode) { cancelShare(); return; } // toggle off
      vm.shareMode = true;
      vm.shareSelected = [];
      document.body.classList.add('share-mode-active');
      document.addEventListener('click', _shareClickHandler, true);
      document.addEventListener('keyup', _shareKeyupHandler, true);
    }

    function cancelShare() {
      vm.shareMode = false;
      vm.shareSelected = [];
      document.body.classList.remove('share-mode-active');
      document.removeEventListener('click', _shareClickHandler, true);
      document.removeEventListener('keyup', _shareKeyupHandler, true);
      // Remove highlight
      var all = document.querySelectorAll('[data-comp-id].share-selected');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('share-selected');
      $scope.$applyAsync();
    }

    /** @private */
    function _shareClickHandler(e) {
      // Walk up from click target to find nearest [data-comp-id]
      var el = e.target;
      var comp = null;
      while (el && el !== document.body) {
        if (el.getAttribute && el.getAttribute('data-comp-id')) {
          comp = el; break;
        }
        el = el.parentElement;
      }
      if (!comp) return;
      e.preventDefault();
      e.stopPropagation();

      // Multi-select with Ctrl
      if (e.ctrlKey) {
        var idx = vm.shareSelected.indexOf(comp);
        if (idx === -1) {
          vm.shareSelected.push(comp);
          comp.classList.add('share-selected');
        } else {
          vm.shareSelected.splice(idx, 1);
          comp.classList.remove('share-selected');
        }
        $scope.$applyAsync();
        return;
      }
      // If Ctrl not held, capture just this one
      vm.shareMode = false;
      vm.shareSelected = [];
      document.body.classList.remove('share-mode-active');
      document.removeEventListener('click', _shareClickHandler, true);
      document.removeEventListener('keyup', _shareKeyupHandler, true);
      comp.classList.remove('share-selected');
      vm.isSharing = true;
      $scope.$applyAsync();
      captureAndSharePanel(comp);
    }

    // When Ctrl is released, generate images for all selected
    function _shareKeyupHandler(e) {
      if (e.key !== 'Control') return;
      if (!vm.shareSelected || !vm.shareSelected.length) return;
      vm.shareMode = false;
      document.body.classList.remove('share-mode-active');
      document.removeEventListener('click', _shareClickHandler, true);
      document.removeEventListener('keyup', _shareKeyupHandler, true);
      var targets = vm.shareSelected.slice();
      for (var i = 0; i < targets.length; i++) targets[i].classList.remove('share-selected');
      var names = [];
      for (var i = 0; i < targets.length; i++) {
        var title = targets[i].querySelector('.panel-header h2');
        names.push(title ? title.textContent.trim() : 'Painel');
      }
      vm.shareSelected = [];
      vm.isSharing = true;
      $scope.$applyAsync();
      // Sequentially capture all panels, then share all together
      var canvases = [];
      var idx = 0;
      function next() {
        if (idx >= targets.length) return shareAllPanels();
        capturePanelToCanvas(targets[idx], function (canvas) {
          canvases.push(canvas);
          idx++;
          next();
        });
      }
      next();

      function shareAllPanels() {
        if (!canvases.length) { vm.isSharing = false; $scope.$applyAsync(); return; }
        var files = [];
        var fileNames = [];
        var msg = 'Dashboard NorthRadar — ' + names.join(' | ') + ' — ' + new Date().toLocaleString('pt-BR');
        var done = 0;
        for (var i = 0; i < canvases.length; i++) {
          (function(i) {
            canvases[i].toBlob(function(blob) {
              if (!blob) { done++; if (done === canvases.length) finishShare(); return; }
              var fileName = 'NorthRadar_' + (names[i] || 'Painel') + '_' + new Date().toLocaleString('pt-BR').replace(/[\/ :]/g, '-') + '.png';
              files[i] = new File([blob], fileName, { type: 'image/png' });
              fileNames[i] = fileName;
              done++;
              if (done === canvases.length) finishShare();
            }, 'image/png');
          })(i);
        }
        function finishShare() {
          // Try Web Share API (mobile)
          if (navigator.share && navigator.canShare) {
            var shareData = { files: files, title: 'NorthRadar', text: msg };
            if (navigator.canShare(shareData)) {
              navigator.share(shareData)
                .catch(function () {})
                .finally(function () {
                  vm.isSharing = false;
                  $scope.$applyAsync();
                });
              return;
            }
          }
          // Fallback: download all PNGs + open wa.me
          for (var i = 0; i < files.length; i++) {
            var url = URL.createObjectURL(files[i]);
            var a = document.createElement('a');
            a.href = url;
            a.download = fileNames[i];
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
          window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
          vm.isSharing = false;
          $scope.$applyAsync();
        }
      }
      function capturePanelToCanvas(panel, cb) {
        // Remove overflow/size constraints
        var saved = [];
        var allEls = panel.querySelectorAll('*');
        for (var i = 0; i < allEls.length; i++) {
          var s = allEls[i];
          var cs = getComputedStyle(s);
          var needsFix = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
                      || (cs.maxHeight !== 'none' && cs.maxHeight !== '0px')
                      || (cs.maxWidth  !== 'none' && cs.maxWidth  !== '0px');
          if (needsFix) {
            saved.push({
              el: s,
              overflow: s.style.overflow,
              overflowX: s.style.overflowX,
              overflowY: s.style.overflowY,
              maxHeight: s.style.maxHeight,
              maxWidth: s.style.maxWidth,
              height: s.style.height,
              width: s.style.width,
              minWidth: s.style.minWidth
            });
            s.style.overflow = 'visible';
            s.style.overflowX = 'visible';
            s.style.overflowY = 'visible';
            s.style.maxHeight = 'none';
            s.style.maxWidth = 'none';
            s.style.height = 'auto';
            s.style.minWidth = '0';
          }
        }
        var compSaved = {
          overflow: panel.style.overflow,
          overflowX: panel.style.overflowX,
          overflowY: panel.style.overflowY,
          maxHeight: panel.style.maxHeight,
          maxWidth: panel.style.maxWidth,
          height: panel.style.height,
          width: panel.style.width,
          minWidth: panel.style.minWidth
        };
        panel.style.overflow = 'visible';
        panel.style.overflowX = 'visible';
        panel.style.overflowY = 'visible';
        panel.style.maxHeight = 'none';
        panel.style.maxWidth = 'none';
        panel.style.width = 'max-content';
        panel.style.minWidth = '0';
        void panel.offsetWidth;
        html2canvas(panel, {
          backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-primary').trim() || '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
          scrollY: -window.scrollY,
          scrollX: -window.scrollX,
          width:  panel.scrollWidth,
          height: panel.scrollHeight
        }).then(function (canvas) {
          for (var j = 0; j < saved.length; j++) {
            var r = saved[j];
            r.el.style.overflow = r.overflow;
            r.el.style.overflowX = r.overflowX;
            r.el.style.overflowY = r.overflowY;
            r.el.style.maxHeight = r.maxHeight;
            r.el.style.maxWidth = r.maxWidth;
            r.el.style.height = r.height;
            r.el.style.width = r.width;
            r.el.style.minWidth = r.minWidth;
          }
          panel.style.overflow = compSaved.overflow;
          panel.style.overflowX = compSaved.overflowX;
          panel.style.overflowY = compSaved.overflowY;
          panel.style.maxHeight = compSaved.maxHeight;
          panel.style.maxWidth = compSaved.maxWidth;
          panel.style.height = compSaved.height;
          panel.style.width = compSaved.width;
          panel.style.minWidth = compSaved.minWidth;
          cb(canvas);
        }).catch(function () { cb(null); });
      }
    }

    function captureAndSharePanel(panel, name, cb) {
      // Remove overflow/size constraints
      var saved = [];
      var allEls = panel.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        var s = allEls[i];
        var cs = getComputedStyle(s);
        var needsFix = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
                    || (cs.maxHeight !== 'none' && cs.maxHeight !== '0px')
                    || (cs.maxWidth  !== 'none' && cs.maxWidth  !== '0px');
        if (needsFix) {
          saved.push({
            el: s,
            overflow: s.style.overflow,
            overflowX: s.style.overflowX,
            overflowY: s.style.overflowY,
            maxHeight: s.style.maxHeight,
            maxWidth: s.style.maxWidth,
            height: s.style.height,
            width: s.style.width,
            minWidth: s.style.minWidth
          });
          s.style.overflow = 'visible';
          s.style.overflowX = 'visible';
          s.style.overflowY = 'visible';
          s.style.maxHeight = 'none';
          s.style.maxWidth = 'none';
          s.style.height = 'auto';
          s.style.minWidth = '0';
        }
      }
      var compSaved = {
        overflow: panel.style.overflow,
        overflowX: panel.style.overflowX,
        overflowY: panel.style.overflowY,
        maxHeight: panel.style.maxHeight,
        maxWidth: panel.style.maxWidth,
        height: panel.style.height,
        width: panel.style.width,
        minWidth: panel.style.minWidth
      };
      panel.style.overflow = 'visible';
      panel.style.overflowX = 'visible';
      panel.style.overflowY = 'visible';
      panel.style.maxHeight = 'none';
      panel.style.maxWidth = 'none';
      panel.style.width = 'max-content';
      panel.style.minWidth = '0';
      void panel.offsetWidth;
      html2canvas(panel, {
        backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-primary').trim() || '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        scrollY: -window.scrollY,
        scrollX: -window.scrollX,
        width:  panel.scrollWidth,
        height: panel.scrollHeight
      }).then(function (canvas) {
        for (var j = 0; j < saved.length; j++) {
          var r = saved[j];
          r.el.style.overflow = r.overflow;
          r.el.style.overflowX = r.overflowX;
          r.el.style.overflowY = r.overflowY;
          r.el.style.maxHeight = r.maxHeight;
          r.el.style.maxWidth = r.maxWidth;
          r.el.style.height = r.height;
          r.el.style.width = r.width;
          r.el.style.minWidth = r.minWidth;
        }
        panel.style.overflow = compSaved.overflow;
        panel.style.overflowX = compSaved.overflowX;
        panel.style.overflowY = compSaved.overflowY;
        panel.style.maxHeight = compSaved.maxHeight;
        panel.style.maxWidth = compSaved.maxWidth;
        panel.style.height = compSaved.height;
        panel.style.width = compSaved.width;
        panel.style.minWidth = compSaved.minWidth;
        canvas.toBlob(function (blob) {
          if (!blob) { if (cb) cb(); return; }
          var ts = new Date().toLocaleString('pt-BR').replace(/[\/ :]/g, '-');
          var fileName = 'NorthRadar_' + (name || 'Painel') + '_' + ts + '.png';
          var msg = encodeURIComponent('Dashboard NorthRadar — ' + (name || 'Painel') + ' — ' + new Date().toLocaleString('pt-BR'));
          // Try Web Share API (mobile)
          if (navigator.share && navigator.canShare) {
            var file = new File([blob], fileName, { type: 'image/png' });
            var shareData = { files: [file], title: 'NorthRadar', text: msg };
            if (navigator.canShare(shareData)) {
              navigator.share(shareData)
                .catch(function () {})
                .finally(function () { if (cb) cb(); });
              return;
            }
          }
          // Fallback: download PNG + open wa.me
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          window.open('https://wa.me/?text=' + msg, '_blank');
          if (cb) cb();
        }, 'image/png');
      }).catch(function () { if (cb) cb(); });
    }

    function fecharPopup() {
      vm.popup.visible = false;
      vm.popup.dados = [];
      vm.expandedCell.visible = false;
    }

    function expandCell($event, label, value) {
      $event.stopPropagation();
      var rect = $event.currentTarget.getBoundingClientRect();
      var top = rect.bottom + 4;
      var left = rect.left;

      // Keep box within viewport
      if (top + 330 > window.innerHeight) { top = rect.top - 330; if (top < 8) top = 8; }
      if (left + 520 > window.innerWidth) { left = window.innerWidth - 530; if (left < 8) left = 8; }

      vm.expandedCell = {
        visible: true,
        label: label || '',
        value: (value == null ? '' : '' + value),
        top: top,
        left: left
      };
    }

    function closeExpandedCell() {
      vm.expandedCell.visible = false;
    }

    /**
     * Define TODAS as colunas da tabela do popup.
     * A ordem muda conforme o contexto do clique:
     * colunas contextuais vêm primeiro, depois as demais na ordem padrão.
     */
    function _getColunasContexto(tipo, campo) {

      // ── Todas as colunas disponíveis (ordem padrão) ──
      var todas = [
        { key: 'numero',                  label: 'Incidência' },
        { key: 'chi',                     label: 'CHI' },
        { key: 'nivelTensao',             label: 'NT' },
        { key: 'nivelTensaoComTipo',      label: 'NT c/ Tipo' },
        { key: 'estado',                  label: 'Estado' },
        { key: 'tipo',                    label: 'Tipo' },
        { key: 'dataInicio',              label: 'Data Início' },
        { key: 'dataAtribuicao',          label: 'Data Atribuição' },
        { key: 'dataInicioDeslocamento',  label: 'Início Desloc.' },
        { key: 'dataChegada',             label: 'Data Chegada' },
        { key: 'dataFim',                 label: 'Data Fim' },
        { key: 'duracao',                 label: 'Duração' },
        { key: 'dataPrevisaoAtendimento', label: 'Previsão Atend.' },
        { key: 'dataEscalonamento',       label: 'Escalonamento' },
        { key: 'polo',                    label: 'Polo' },
        { key: 'sucursal',                label: 'Sucursal' },
        { key: 'conjunto',                label: 'Conjunto' },
        { key: 'regiao',                  label: 'Região' },
        { key: 'municipio',               label: 'Município' },
        { key: 'causa',                   label: 'Causa' },
        { key: 'clientesAfetadosAtual',   label: 'Cli. Afetados' },
        { key: 'normalizadosAbaixo3Min',  label: 'Norm. <3min' },
        { key: 'clientesAfetadosAcima3Min', label: 'Cli. >3min' },
        { key: 'afetacaoMaxima',          label: 'Afet. Máxima' },
        { key: 'conh',                    label: 'CONH' },
        { key: 'cd',                      label: 'CD' },
        { key: 'alimentador',             label: 'Alimentador' },
        { key: 'pontoEletrico',           label: 'Ponto Elétrico' },
        { key: 'eletrodependente',        label: 'Cl. Críticos' },
        { key: 'urgente',                 label: 'Urgente' },
        { key: 'condominio',              label: 'Condomínio' },
        { key: 'improdutiva',             label: 'Improdutiva' },
        { key: 'reincidente',             label: 'Reincidente' },
        { key: 'amplaChip',               label: 'Ampla Chip' },
        { key: 'energiaSolar',            label: 'Energia Solar' },
        { key: 'iluminacaoPublica',       label: 'Ilum. Pública' },
        { key: 'totalAvisos',             label: 'Total Avisos' },
        { key: 'numeroCliente',           label: 'Nº Cliente' },
        { key: 'tipoReclamacao',          label: 'Tipo Reclamação' },
        { key: 'callback',                label: 'Callback' },
        { key: 'retornoCallback',         label: 'Retorno Callback' },
        { key: 'resultadoLigacaoCallback', label: 'Resultado Lig. CB' },
        { key: 'motivoCallback',          label: 'Motivo Callback' },
        { key: 'monitorRamal',            label: 'Monitor Ramal' },
        { key: 'alarmeMR',                label: 'Alarme MR' },
        { key: 'statusMonitorRamal',      label: 'Status MR' },
        { key: 'inicioMR',                label: 'Início MR' },
        { key: 'equipeAtribuida',         label: 'Eq. Atribuída' },
        { key: 'equipeDeslocada',         label: 'Eq. Deslocada' },
        { key: 'tmp',                     label: 'TMP' },
        { key: 'tmd',                     label: 'TMD' },
        { key: 'tme',                     label: 'TME' },
        { key: 'tma',                     label: 'TMA' },
        { key: 'tempoPreparacao',         label: 'Tempo Preparação' },
        { key: 'tempoDeslocamento',       label: 'Tempo Desloc.' },
        { key: 'tempoExecucao',           label: 'Tempo Execução' },
        { key: 'tempoAtendimento',        label: 'Tempo Atend.' },
        { key: 'tempoParaManobra',        label: 'Tempo Manobra' },
        { key: 'tempoAgrupado',           label: 'Tempo Agrupado' },
        { key: 'latitude',                label: 'Latitude' },
        { key: 'longitude',               label: 'Longitude' },
        { key: 'compensacao',             label: 'Compensação' },
        { key: 'nivelCompensasao',        label: 'Nível Compens.' },
        { key: 'valorCompensacao',        label: 'Valor Compens.' },
        { key: 'statusURA',               label: 'Status URA' },
        { key: 'resultadoURA',            label: 'Resultado URA' },
        { key: 'resultadoBOT',            label: 'Resultado BOT' },
        { key: 'motivoBOT',               label: 'Motivo BOT' },
        { key: 'tipoAgrupamento',         label: 'Tipo Agrupam.' },
        { key: 'clienteEssencial',        label: 'Cl. Essencial' },
        { key: 'osm',                     label: 'OSM' },
        { key: 'ordem2',                  label: 'Ordem 2' },
        { key: 'cumpreRegrasOuro',        label: 'Regras Ouro' },
        { key: 'areaRisco',               label: 'Área Risco' },
        { key: 'convergencia',            label: 'Convergência' },
        { key: 'pontoAtencao',            label: 'Ponto Atenção' },
        { key: 'periodo',                 label: 'Período' },
        { key: 'operador',                label: 'Operador' },
        { key: 'numerosAvisos',           label: 'Nº Avisos' },
        { key: 'numerosProtocolos',       label: 'Nº Protocolos' },
        { key: 'observacao',              label: 'Observação' },
        { key: 'ccUc',                    label: 'CC - UC' },
        { key: 'ccNome',                  label: 'CC - Nome' },
        { key: 'ccSegmento',              label: 'CC - Segmento' },
        { key: 'ccCriticidade',           label: 'CC - Criticidade' },
        { key: 'ccAviso',                 label: 'CC - Aviso' }
      ];

      // ── Colunas extras (contextuais, inseridas no início) ──
      var extras = [];

      // ── Definir quais keys devem ir para o início conforme o clique ──
      var prioridade = [];

      if (campo === 'eletrodependente') {
        prioridade = ['eletrodependente', 'ccUc', 'ccNome', 'ccSegmento', 'ccCriticidade', 'ccAviso'];
      } else if (campo === 'urgente') {
        prioridade = ['urgente'];
      } else if (campo === 'chi') {
        prioridade = ['chi', 'clientesAfetadosAtual', 'duracao'];
      } else if (campo === 'cli' || campo === 'totalClientes' || campo === 'clientesAfetados') {
        prioridade = ['clientesAfetadosAtual', 'chi', 'afetacaoMaxima'];
      } else if (campo === 'tma') {
        prioridade = ['duracao', 'tma', 'tme', 'tmd', 'tmp'];
      } else if (campo === 'naoDespachados') {
        prioridade = ['atribuicao', 'equipeAtribuida', 'equipeDeslocada'];
      } else if (campo === 'clEssencial') {
        prioridade = ['clienteEssencial'];
      } else if (campo === 'qttAvisos') {
        prioridade = ['totalAvisos', 'numerosAvisos'];
      } else if (campo === 'incidenciasAtivas') {
        prioridade = ['estado', 'dataInicio', 'duracao'];
      } else if (campo === 'lt8h' || campo === 'h8_16' || campo === 'h16_24' || campo === 'h24_48' || campo === 'gt48h') {
        prioridade = ['duracao', 'tma', 'dataInicio'];
      } else if (campo === 'conjunto') {
        prioridade = ['conjunto', 'estado', 'dataInicio', 'duracao'];
      } else if (campo === 'equipes') {
        prioridade = ['atribuicao', 'equipeAtribuida', 'equipeDeslocada'];
      } else if (campo === 'qtt2Rec') {
        prioridade = ['atribuicao', 'equipeAtribuida', 'equipeDeslocada'];
      } else if (campo === 'desl') {
        prioridade = ['numero', 'estado', 'equipeAtribuida', 'equipeDeslocada', 'dataAtribuicao', 'dataInicioDeslocamento', 'dataChegada', 'duracao', 'clientesAfetadosAtual', 'cd', 'alimentador'];
      } else if (tipo === 'equipe') {
        prioridade = ['atribuicao', 'equipeAtribuida', 'equipeDeslocada'];
      }

      // Reordenar: prioridade primeiro, depois o resto na ordem original
      var result = extras.slice();
      var usedKeys = {};
      for (var e = 0; e < extras.length; e++) usedKeys[extras[e].key] = true;

      // Adicionar colunas prioritárias
      for (var p = 0; p < prioridade.length; p++) {
        for (var t = 0; t < todas.length; t++) {
          if (todas[t].key === prioridade[p] && !usedKeys[todas[t].key]) {
            result.push(todas[t]);
            usedKeys[todas[t].key] = true;
            break;
          }
        }
      }

      // Adicionar as demais colunas na ordem original
      for (var i = 0; i < todas.length; i++) {
        if (!usedKeys[todas[i].key]) {
          result.push(todas[i]);
        }
      }

      return result;
    }

    function _getTituloPopup(tipo, campo, valor) {
      var labels = {
        urgente: 'Incidências Urgentes',
        eletrodependente: 'Incidências com Clientes Críticos',
        totalIncidencias: 'Todas as Incidências Ativas',
        totalClientes: 'Incidências com Clientes Afetados',
        clientesAfetados: 'Incidências com Clientes Afetados',
        naoDespachados: 'Incidências Não Despachadas',
        chi: 'Incidências por CHI',
        cli: 'Incidências por Clientes',
        tma: 'Incidências por TMA',
        incidenciasAtivas: 'Incidências Ativas',
        clEssencial: 'Incidências com Clientes Essenciais',
        qttAvisos: 'Incidências com Avisos',
        lt8h: 'Incidências < 08h',
        h8_16: 'Incidências 08h–16h',
        h16_24: 'Incidências 16h–24h',
        h24_48: 'Incidências 24h–48h',
        gt48h: 'Incidências > 48h',
        conjunto: 'Incidências do Conjunto',
        equipes: 'Incidências com Equipe',
        qtt2Rec: 'Incidências Equipes Extras'
      };

      var label = labels[campo] || ('Incidências — ' + campo);

      if (tipo === 'panorama' && valor) {
        label += ' — ' + valor;
      } else if (tipo === 'equipe' && valor) {
        label = 'Incidências da Equipe ' + valor;
      } else if (tipo === 'top10' && valor) {
        label = 'Detalhes Incidência ' + valor;
      }

      return label;
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
