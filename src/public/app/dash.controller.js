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

    // ── Drag-and-drop section ordering ───────────────────
    var STORAGE_KEY = 'northradar_section_order';
    var THEME_KEY   = 'northradar_theme';
    var defaultOrder = ['top10', 'panorama', 'equipes', 'equipes2'];
    vm.sectionOrder  = loadSectionOrder();
    vm.draggingSection = null;

    // ── Dark mode ────────────────────────────────────────
    vm.darkMode = loadTheme();
    vm.toggleTheme = toggleTheme;

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
