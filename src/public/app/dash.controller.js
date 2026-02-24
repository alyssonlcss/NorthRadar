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
      '$interval', '$timeout', '$q',
      'DashApi', 'DashProcessor', 'DashHelpers',
      DashCtrl
    ]);

  function DashCtrl($interval, $timeout, $q, Api, Proc, Helpers) {
    var vm = this;

    // ── View-model state ─────────────────────────────────
    vm.polos          = ['TODOS', 'ATLANTICO', 'DECEN', 'DNORT'];
    vm.selectedPolo   = 'TODOS';
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
    vm.currentView = 'operational';
    vm.switchView  = switchView;
    var _chartInstances = {};

    // ── Drag-and-drop section ordering ───────────────────
    var STORAGE_KEY = 'northradar_section_order';
    var THEME_KEY   = 'northradar_theme';
    var defaultOrder = ['top10', 'panorama', 'equipes', 'equipes2'];
    vm.sectionOrder  = loadSectionOrder();
    vm.draggingSection = null;

    // ── Dark mode ────────────────────────────────────────
    vm.darkMode = loadTheme();
    vm.toggleTheme = toggleTheme;

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
    vm.sortBy         = sortBy;
    vm.expandCell     = expandCell;
    vm.closeExpandedCell = closeExpandedCell;
    vm.onDragStart    = onDragStart;
    vm.onDragOver     = onDragOver;
    vm.onDragLeave    = onDragLeave;
    vm.onDrop         = onDrop;
    vm.onDragEnd      = onDragEnd;
    vm.getSectionOrder = getSectionOrder;

    // ── Bootstrap ────────────────────────────────────────
    checkAuthAndLoad();
    $interval(loadAll, 900000); // 15 min

    // ═══════════════════════════════════════════════════════
    // DRAG-AND-DROP SECTION REORDERING
    // ═══════════════════════════════════════════════════════

    function loadSectionOrder() {
      try {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          var parsed = JSON.parse(saved);
          // Validate that it's a valid array with the expected keys
          if (Array.isArray(parsed) && parsed.length === defaultOrder.length) {
            return parsed;
          }
        }
      } catch (e) { /* ignore */ }
      return defaultOrder.slice();
    }

    function saveSectionOrder() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vm.sectionOrder)); }
      catch (e) { /* ignore */ }
    }

    // ── Theme persistence ────────────────────────────────
    function loadTheme() {
      try {
        return localStorage.getItem(THEME_KEY) === 'dark';
      } catch (e) { return false; }
    }

    function toggleTheme() {
      vm.darkMode = !vm.darkMode;
      try { localStorage.setItem(THEME_KEY, vm.darkMode ? 'dark' : 'light'); }
      catch (e) { /* ignore */ }
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
      vm.selectedPolo = polo;
      vm.dropdownOpen = false;
      changePolo(polo);
    }

    function getSectionOrder(sectionId) {
      var idx = vm.sectionOrder.indexOf(sectionId);
      return { order: idx >= 0 ? idx + 1 : 99 };
    }

    function onDragStart($event, sectionId) {
      vm.draggingSection = sectionId;
      $event.dataTransfer.effectAllowed = 'move';
      $event.dataTransfer.setData('text/plain', sectionId);
      // Add dragging class
      var target = findDragSection($event.target);
      if (target) target.classList.add('dragging');
    }

    function onDragOver($event) {
      $event.preventDefault();
      $event.dataTransfer.dropEffect = 'move';
      var target = findDragSection($event.target);
      if (target && target.dataset.sectionId !== vm.draggingSection) {
        target.classList.add('drag-over');
      }
    }

    function onDragLeave($event) {
      var target = findDragSection($event.target);
      if (target) target.classList.remove('drag-over');
    }

    function onDrop($event, targetId) {
      $event.preventDefault();
      var sourceId = vm.draggingSection;
      // Remove visual states
      var allSections = document.querySelectorAll('.drag-section');
      for (var i = 0; i < allSections.length; i++) {
        allSections[i].classList.remove('drag-over', 'dragging');
      }

      if (sourceId && sourceId !== targetId) {
        var srcIdx = vm.sectionOrder.indexOf(sourceId);
        var tgtIdx = vm.sectionOrder.indexOf(targetId);
        if (srcIdx >= 0 && tgtIdx >= 0) {
          // Remove source from array and insert at target position
          vm.sectionOrder.splice(srcIdx, 1);
          vm.sectionOrder.splice(tgtIdx, 0, sourceId);
          saveSectionOrder();
        }
      }
      vm.draggingSection = null;
    }

    function onDragEnd($event) {
      vm.draggingSection = null;
      var allSections = document.querySelectorAll('.drag-section');
      for (var i = 0; i < allSections.length; i++) {
        allSections[i].classList.remove('drag-over', 'dragging');
      }
    }

    function findDragSection(el) {
      while (el && !el.classList.contains('drag-section')) {
        el = el.parentElement;
      }
      return el;
    }

    // ═══════════════════════════════════════════════════════
    // ANALYTICS VIEW — ROUTE SWITCHING & CHARTS
    // ═══════════════════════════════════════════════════════

    function switchView(view) {
      vm.currentView = view;
      if (view === 'analytics') {
        $timeout(buildAllCharts, 150);
      }
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
      var labels = list.map(function (r) { return r.numero || r.incidencia || '—'; });
      var data = list.map(function (r) { return r.chi || 0; });
      var colors = _chartColors(list.length);
      var ctxMap = list.map(function (r) { return { tipo: 'top10', campo: 'chi', valor: r.numero }; });

      _makeChart('chartTop10Chi', 'top10Chi', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'CHI', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('top10Chi', ctxMap, evt, els); },
          layout: { padding: { left: 10 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 11, weight: '500' }, padding: 6, autoSkip: false } }
          }
        })
      });
    }

    // 4) Bar — Clientes afetados por conjunto (top 8)
    function _buildChartClientesConj() {
      var sorted = (vm.panorama || []).slice().sort(function (a, b) { return (b.clientesAfetados || 0) - (a.clientesAfetados || 0); });
      var top8 = sorted.slice(0, 8);
      var labels = top8.map(function (r) { return r.conjunto || '—'; });
      var data = top8.map(function (r) { return r.clientesAfetados || 0; });
      var colors = _chartColors(top8.length);
      var ctxMap = top8.map(function (r) { return { tipo: 'panorama', campo: 'clientesAfetados', valor: r.conjunto }; });

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
      var labels = list.map(function (r) { return r.numero || '—'; });
      var data = list.map(function (r) { return r.clientesAfetadosAtual || r.clientesAfetados || 0; });
      var colors = _chartColors(list.length);
      var ctxMap = list.map(function (r) { return { tipo: 'top10', campo: 'cli', valor: r.numero }; });

      _makeChart('chartTop10Cli', 'top10Cli', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Clientes', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('top10Cli', ctxMap, evt, els); },
          layout: { padding: { left: 10 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 11, weight: '500' }, padding: 6, autoSkip: false } }
          }
        })
      });
    }

    // 8) Horizontal bar — Top 10 TMA (ativas)
    function _buildChartTop10Tma() {
      var list = (vm.top10Tma || []).slice(0, 10);
      var labels = list.map(function (r) { return r.numero || '—'; });
      var data = list.map(function (r) { return r.tma || 0; });
      var colors = _chartColors(list.length);
      var ctxMap = list.map(function (r) { return { tipo: 'top10', campo: 'tma', valor: r.numero }; });

      _makeChart('chartTop10Tma', 'top10Tma', {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'TMA (min)', data: data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
        options: angular.merge({}, _baseOptions(), {
          indexAxis: 'y',
          onClick: function (evt, els) { _onChartClick('top10Tma', ctxMap, evt, els); },
          layout: { padding: { left: 10 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 11, weight: '500' }, padding: 6, autoSkip: false } }
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
          layout: { padding: { left: 10 } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 11, weight: '500' }, padding: 6, autoSkip: false } }
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
          layout: { padding: { left: 10 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: _gridColor() }, ticks: { color: _textColor() } },
            y: { grid: { display: false }, ticks: { color: _textColor(), font: { size: 10, weight: '500' }, padding: 6, autoSkip: false } }
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
      loadAll();
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

        // Mantém totalEquipes vindo de equipes (se já carregou)
        vm.kpis.totalEquipes = vm.totalEquipes;

        vm.loadingInc = false;
        vm.lastUpdate = new Date();
        vm.refreshing = false;

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

          // Refresh equipe-dependent charts
          $timeout(buildAllCharts, 100);
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

      vm.popup = {
        visible: true,
        titulo: _getTituloPopup(tipo, campo, valor),
        contextoCampo: campo,
        dados: dados,
        colunasContexto: colunasContexto
      };

      // Reset popup sort on each open
      vm.sort.popup = { field: '', reverse: false };

      console.log('[Ctrl] Popup aberto: ' + tipo + '/' + campo + ' → ' + dados.length + ' registros');
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
        { key: 'atribuicao',              label: 'Atribuição' },
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
