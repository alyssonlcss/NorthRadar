/**
 * NorthRadar – Dashboard Data Processor
 *
 * Responsável pela lógica de negócio / transformação de dados:
 * - Separar incidências ativas × encerradas
 * - Montar panorama agrupado por conjunto
 * - Calcular KPIs, totais e rankings TOP 10
 * - Mapear equipes com campos robustos
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .factory('DashProcessor', ['DashHelpers', DashProcessor]);

  function DashProcessor(H) {

    /** Tags que identificam equipes 2º recurso */
    var TAGS_2REC = ['PD', 'ML', 'EP', 'LC', 'LL', 'CO', 'MP', 'IN', 'EN', 'MO', 'LV'];

    return {
      processIncidencias: processIncidencias,
      processEquipes: processEquipes
    };

    // ═══════════════════════════════════════════════════════
    // INCIDÊNCIAS
    // ═══════════════════════════════════════════════════════

    /**
     * Processa array bruto de incidências e retorna objeto com
     * panorama, totals, kpis, top10Chi, top10Tma, top10Cli e debugInfo.
     *
     * @param {Array} items - Incidências brutas da API
     * @returns {Object}
     */
    function processIncidencias(items) {
      console.log('[Processor] processIncidencias() chamada com ' + items.length + ' itens');

      if (items.length > 0) {
        var sample = items[0];
        console.log('[Processor] Amostra item[0]:', JSON.stringify(sample).substring(0, 500));
        console.log('[Processor]   estado=' + sample.estado + ', dataFim=' + sample.dataFim + ', conjunto=' + sample.conjunto);
        console.log('[Processor]   clientesAfetadosAtual=' + sample.clientesAfetadosAtual + ', duracao=' + sample.duracao);
      } else {
        console.warn('[Processor] ⚠️ rawIncidencias está vazio!');
        return emptyResult();
      }

      // ── Separar ativas / encerradas ──
      var active = [];
      var closed = [];

      items.forEach(function (inc) {
        if (H.isActive(inc)) {
          active.push(inc);
        } else {
          closed.push(inc);
          if (closed.length === 1) {
            console.log('[Processor] Primeiro encerrado: estado=' + inc.estado + ', dataFim=' + inc.dataFim);
          }
        }
      });

      var debugInfo = { rawCount: items.length, activeCount: active.length, closedCount: closed.length };
      console.log('[Processor] ' + active.length + ' ativas, ' + closed.length + ' encerradas');

      // ── Panorama ──
      var panorama = buildPanorama(active);

      // ── Totals ──
      var totals = buildTotals(panorama);

      // ── KPIs ──
      var kpis = buildKpis(active, totals);

      // ── TOP 10 ──
      var top10Chi = buildTop10(active, 'chi');
      var top10Tma = buildTop10(closed, 'tma');
      var top10Cli = buildTop10(active, 'cli');

      return {
        panorama: panorama,
        totals: totals,
        kpis: kpis,
        top10Chi: top10Chi,
        top10Tma: top10Tma,
        top10Cli: top10Cli,
        debugInfo: debugInfo
      };
    }

    // ── Panorama: agrupar por conjunto ────────────────────

    function buildPanorama(active) {
      var groups = {};

      active.forEach(function (inc) {
        var conj = inc.conjunto || ('N/A - REGIÃO: ' + (inc.regiao || '—'));

        if (!groups[conj]) {
          groups[conj] = {
            conjunto: conj, chi: 0, clientesAfetados: 0, incidenciasAtivas: 0,
            naoDespachados: 0, equipesObj: {}, equipes2RecObj: {},
            qttAvisos: 0, clEssencial: 0, eletrodependente: 0,
            lt8h: 0, h8_16: 0, h16_24: 0, h24_48: 0, gt48h: 0
          };
        }

        var g = groups[conj];
        var incCli = inc.clientesAfetadosAtual || 0;
        var incHrs = H.parseDuracao(inc.duracao);

        g.chi += incCli * incHrs;
        g.clientesAfetados += incCli;
        g.incidenciasAtivas++;

        var eq = inc.equipeAtribuida || '-';
        if (eq === '-') {
          g.naoDespachados++;
        } else {
          g.equipesObj[eq] = true;
          var eqUpper = eq.toUpperCase();
          if (TAGS_2REC.some(function (tag) { return eqUpper.indexOf(tag) >= 0; })) {
            g.equipes2RecObj[eq] = true;
          }
        }

        g.qttAvisos += (inc.totalAvisos || 0);
        g.clEssencial += (inc.clienteEssencial || 0);
        if (inc.eletrodependente === true) g.eletrodependente++;

        var hours = H.parseDuracao(inc.duracao);
        if (hours < 8) g.lt8h++;
        else if (hours < 16) g.h8_16++;
        else if (hours < 24) g.h16_24++;
        else if (hours < 48) g.h24_48++;
        else g.gt48h++;
      });

      // Converter para array
      var list = [];
      var keys = Object.keys(groups);
      for (var k = 0; k < keys.length; k++) {
        var g = groups[keys[k]];
        var eqCount = Object.keys(g.equipesObj).length;
        var eq2Count = Object.keys(g.equipes2RecObj).length;
        list.push({
          conjunto: g.conjunto,
          chi: Math.round(g.chi),
          clientesAfetados: g.clientesAfetados,
          incidenciasAtivas: g.incidenciasAtivas,
          naoDespachados: g.naoDespachados,
          equipes: eqCount,
          incPorEquipe: eqCount > 0 ? (g.incidenciasAtivas / eqCount).toFixed(1) : '—',
          qtt2Rec: eq2Count,
          qttAvisos: g.qttAvisos,
          clEssencial: g.clEssencial,
          eletrodependente: g.eletrodependente,
          lt8h: g.lt8h, h8_16: g.h8_16, h16_24: g.h16_24, h24_48: g.h24_48, gt48h: g.gt48h
        });
      }

      list.sort(function (a, b) { return b.clientesAfetados - a.clientesAfetados; });
      return list;
    }

    // ── Totais ───────────────────────────────────────────

    function buildTotals(panorama) {
      var t = {
        chi: 0, clientesAfetados: 0, incidenciasAtivas: 0, naoDespachados: 0,
        equipes: 0, qtt2Rec: 0, qttAvisos: 0, clEssencial: 0, eletrodependente: 0,
        lt8h: 0, h8_16: 0, h16_24: 0, h24_48: 0, gt48h: 0
      };

      panorama.forEach(function (r) {
        t.chi += r.chi;
        t.clientesAfetados += r.clientesAfetados;
        t.incidenciasAtivas += r.incidenciasAtivas;
        t.naoDespachados += r.naoDespachados;
        t.equipes += r.equipes;
        t.qtt2Rec += r.qtt2Rec;
        t.qttAvisos += r.qttAvisos;
        t.clEssencial += r.clEssencial;
        t.eletrodependente += r.eletrodependente;
        t.lt8h += r.lt8h;
        t.h8_16 += r.h8_16;
        t.h16_24 += r.h16_24;
        t.h24_48 += r.h24_48;
        t.gt48h += r.gt48h;
      });

      t.incPorEquipe = t.equipes > 0 ? (t.incidenciasAtivas / t.equipes).toFixed(1) : '—';
      return t;
    }

    // ── KPIs ─────────────────────────────────────────────

    function buildKpis(active, totals) {
      var urgCount = 0;
      var eleCount = 0;
      var chiTotal = 0;

      active.forEach(function (inc) {
        if (inc.urgente === true || inc.urgente === 'true') urgCount++;
        if (inc.eletrodependente === true || inc.eletrodependente === 'true') eleCount++;
        chiTotal += (inc.clientesAfetadosAtual || 0) * H.parseDuracao(inc.duracao);
      });

      return {
        totalIncidencias: totals.incidenciasAtivas,
        totalClientes: totals.clientesAfetados,
        totalEquipes: 0, // será atualizado pelas equipes
        naoDespachados: totals.naoDespachados,
        urgentes: urgCount,
        eletrodependentes: eleCount,
        totalChi: Math.round(chiTotal)
      };
    }

    // ── TOP 10 ───────────────────────────────────────────

    function buildTop10(items, sortField) {
      return items
        .map(function (inc) { return H.mapIncidence(inc); })
        .sort(function (a, b) { return b[sortField] - a[sortField]; })
        .slice(0, 10);
    }

    // ═══════════════════════════════════════════════════════
    // EQUIPES
    // ═══════════════════════════════════════════════════════

    /**
     * Mapeia equipes brutas da API e separa 2º recurso.
     *
     * @param {Array} rawList - Equipes brutas
     * @returns {{ equipes: Array, equipes2Recurso: Array, totalEquipes: number, totalEquipes2: number }}
     */
    function processEquipes(rawList) {
      var equipes = rawList.map(function (eq) {
        return {
          nome:              H.getField(eq, 'nome', 'nomeEquipe', 'name') || '',
          polo:              H.getField(eq, 'polo', 'nomePolo') || '',
          sucursal:          H.getField(eq, 'sucursal', 'nomeSucursal') || '',
          nivelTensao:       H.getField(eq, 'nivelTensao', 'nivelDeTensao') || '',
          nivelTensaoAtual:  H.getField(eq, 'nivelTensaoAtual', 'nivelTensaoCorrente') || '',
          atribuidas:        H.getField(eq, 'atribuidas', 'qtdAtribuidas', 'totalAtribuidas') || 0,
          improdutivas:      H.getField(eq, 'improdutivas', 'qtdImprodutivas', 'totalImprodutivas') || 0,
          emergenciais:      H.getField(eq, 'emergenciais', 'qtdEmergenciais', 'totalEmergenciais') || 0,
          comerciais:        H.getField(eq, 'comerciais', 'qtdComerciais', 'totalComerciais') || 0,
          tempoServico:      H.getField(eq, 'tempoServico', 'tempoDeServico', 'serviceTime') || '',
          dataHoraInicio:    H.getField(eq, 'dataHoraInicio', 'dataInicio', 'inicioTurno') || '',
          produtividadeHora: H.getField(eq, 'produtividadeHora', 'produtividade', 'productivity') || 0,
          _raw: eq
        };
      });

      var equipes2Recurso = equipes.filter(function (eq) {
        var nome = (eq.nome || '').toUpperCase();
        return TAGS_2REC.some(function (tag) { return nome.indexOf(tag) >= 0; });
      });

      return {
        equipes: equipes,
        equipes2Recurso: equipes2Recurso,
        totalEquipes: equipes.length,
        totalEquipes2: equipes2Recurso.length
      };
    }

    // ── Empty fallback ───────────────────────────────────

    function emptyResult() {
      return {
        panorama: [],
        totals: {},
        kpis: { totalIncidencias: 0, totalClientes: 0, totalEquipes: 0, naoDespachados: 0, urgentes: 0, eletrodependentes: 0, totalChi: 0 },
        top10Chi: [],
        top10Tma: [],
        top10Cli: [],
        debugInfo: { rawCount: 0, activeCount: 0, closedCount: 0 }
      };
    }
  }

})();
