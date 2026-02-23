/**
 * NorthRadar – Dashboard Data Processor
 *
 * Responsável pela lógica de negócio / transformação de dados:
 * - Separar incidências ativas × encerradas
 * - Montar panorama agrupado por conjunto
 * - Calcular KPIs, totais e rankings TOP 10
 * - Cruzar clientes críticos com incidências
 * - Filtrar incidências por contexto de clique (popup universal)
 * - Mapear equipes com campos robustos
 */
(function () {
  'use strict';

  angular.module('dashApp')
    .factory('DashProcessor', ['DashHelpers', DashProcessor]);

  function DashProcessor(H) {

    /** Tags que identificam equipes extras (carregadas exclusivamente via .env) */
    var _tagsExtras = [];

    return {
      processIncidencias: processIncidencias,
      processEquipes: processEquipes,
      cruzarClientesCriticos: cruzarClientesCriticos,
      filtrarIncidenciasPorContexto: filtrarIncidenciasPorContexto,
      setTagsEquipesExtras: function (tags) {
        if (Array.isArray(tags) && tags.length > 0) {
          _tagsExtras = tags.map(function (t) { return t.trim().toUpperCase(); }).filter(Boolean);
          console.log('[Processor] Tags equipes extras atualizadas:', _tagsExtras.join(', '));
        }
      }
    };

    // ═══════════════════════════════════════════════════════
    // CLIENTES CRÍTICOS – CRUZAMENTO
    // ═══════════════════════════════════════════════════════

    /**
     * Cruza clientes críticos com incidências:
     *   clienteCritico.incidencia === incidencia.numero
     *
     * @param {Array} clientesCriticos - resposta de /clientes-criticos/consultar
     * @param {Array} incidencias      - incidências brutas
     * @returns {{ clientesPorIncidencia, eletrodepPorConjunto, totalEletrodep }}
     */
    function cruzarClientesCriticos(clientesCriticos, incidencias) {
      var clientesPorIncidencia = {};
      var eletrodepPorConjunto = {};   // contagem de clientes Vital por conjunto
      var avisoPorConjunto = {};       // true se algum cliente tem aviso ativo
      var totalEletrodep = 0;

      // Indexar incidências por numero
      var incMap = {};
      incidencias.forEach(function (inc) {
        if (inc.numero) incMap[inc.numero] = inc;
      });

      (clientesCriticos || []).forEach(function (cl) {
        var incNum = cl.incidencia || '';
        if (!incNum) return;

        if (!clientesPorIncidencia[incNum]) {
          clientesPorIncidencia[incNum] = [];
        }
        clientesPorIncidencia[incNum].push(cl);

        var inc = incMap[incNum];
        var conj = inc ? (inc.conjunto || 'N/A') : 'N/A';

        // Contar TODOS os clientes críticos de incidências ATIVAS
        // (qualquer segmento: Vital, Saneamento, Educação, Hospitais, etc.)
        if (inc && H.isActive(inc)) {
          totalEletrodep++;
          eletrodepPorConjunto[conj] = (eletrodepPorConjunto[conj] || 0) + 1;
        }

        // Piscar card somente para clientes VITAIS com aviso ativo em incidências ativas
        if (cl.segmento === 'Vital' && cl.aviso && cl.aviso !== '' && cl.aviso !== '-' && inc && H.isActive(inc)) {
          avisoPorConjunto[conj] = true;
        }
      });

      console.log('[Processor] Clientes críticos cruzados: ' + (clientesCriticos || []).length +
                  ' clientes, ' + totalEletrodep + ' clientes críticos (todos os segmentos) em incidências ativas.');

      return {
        clientesPorIncidencia: clientesPorIncidencia,
        eletrodepPorConjunto: eletrodepPorConjunto,
        avisoPorConjunto: avisoPorConjunto,
        totalEletrodep: totalEletrodep
      };
    }

    // ═══════════════════════════════════════════════════════
    // FILTRO POR CONTEXTO (para popup universal)
    // ═══════════════════════════════════════════════════════

    /**
     * Filtra incidências pelo contexto de clique e cruza com clientes.
     *
     * @param {Object} contexto
     *   - tipo:  'card' | 'panorama' | 'top10' | 'equipe'
     *   - campo: nome do campo clicado
     *   - valor: filtro adicional (conjunto, numero, equipe)
     * @param {Array}  incidencias           - todas as incidências brutas
     * @param {Object} clientesPorIncidencia - mapa do cruzamento
     * @returns {Array}
     */
    function filtrarIncidenciasPorContexto(contexto, incidencias, clientesPorIncidencia) {
      var filtered = [];

      switch (contexto.tipo) {

        case 'card':
          filtered = incidencias.filter(function (inc) {
            if (!H.isActive(inc)) return false;
            if (contexto.campo === 'urgente') return inc.urgente === true || inc.urgente === 'true';
            if (contexto.campo === 'eletrodependente') {
              if (inc.eletrodependente === true) return true;
              var cls = clientesPorIncidencia[inc.numero] || [];
              return cls.length > 0;
            }
            if (contexto.campo === 'totalIncidencias') return true;
            if (contexto.campo === 'totalClientes') return (inc.clientesAfetadosAtual || 0) > 0;
            if (contexto.campo === 'naoDespachados') {
              var eq = _getEquipe(inc);
              return !eq || eq === '-';
            }
            return true;
          });
          break;

        case 'panorama':
          filtered = incidencias.filter(function (inc) {
            if (!H.isActive(inc)) return false;
            var conj = inc.conjunto || ('N/A - REGIÃO: ' + (inc.regiao || '—'));
            if (contexto.valor && conj !== contexto.valor) return false;
            if (contexto.campo === 'eletrodependente') {
              if (inc.eletrodependente === true) return true;
              var cls = clientesPorIncidencia[inc.numero] || [];
              return cls.length > 0;
            }
            if (contexto.campo === 'naoDespachados') {
              var eq = _getEquipe(inc);
              return !eq || eq === '-';
            }
            if (contexto.campo === 'equipes') {
              var eqE = _getEquipe(inc);
              return eqE && eqE !== '-';
            }
            if (contexto.campo === 'qtt2Rec') {
              var eq2 = _getEquipe(inc);
              if (!eq2 || eq2 === '-') return false;
              var eq2Upper = eq2.toUpperCase();
              return _tagsExtras.some(function (tag) { return eq2Upper.indexOf(tag) >= 0; });
            }
            if (contexto.campo === 'lt8h' || contexto.campo === 'h8_16' ||
                contexto.campo === 'h16_24' || contexto.campo === 'h24_48' ||
                contexto.campo === 'gt48h') {
              var horas = H.parseDuracao(inc.duracao);
              if (contexto.campo === 'lt8h')   return horas < 8;
              if (contexto.campo === 'h8_16')  return horas >= 8  && horas < 16;
              if (contexto.campo === 'h16_24') return horas >= 16 && horas < 24;
              if (contexto.campo === 'h24_48') return horas >= 24 && horas < 48;
              if (contexto.campo === 'gt48h')  return horas >= 48;
            }
            return true;
          });
          break;

        case 'top10':
          filtered = incidencias.filter(function (inc) {
            return inc.numero === contexto.valor;
          });
          break;

        case 'equipe':
          filtered = incidencias.filter(function (inc) {
            if (!H.isActive(inc)) return false;
            var eqDesl = inc.equipeDeslocada && inc.equipeDeslocada !== '-' ? inc.equipeDeslocada : null;
            var eqAtrib = inc.equipeAtribuida && inc.equipeAtribuida !== '-' ? inc.equipeAtribuida : null;
            return eqDesl === contexto.valor || eqAtrib === contexto.valor;
          });
          break;

        default:
          filtered = incidencias;
      }

      // Enriquecer com TODOS os campos da incidência + clientes críticos + CHI calculado
      // Se a incidência tem N clientes críticos, gera N linhas (uma por cliente).
      // Se não tem nenhum, gera 1 linha com ccUc/ccNome/etc = '—'.
      var result = [];
      filtered.forEach(function (inc) {
        var clientes = clientesPorIncidencia[inc.numero] || [];
        var duracaoHours = H.parseDuracao(inc.duracao);
        var chi = Math.round((inc.clientesAfetadosAtual || 0) * duracaoHours * 10) / 10;

        var baseRow = {
          // Identificação
          numero: inc.numero || '',
          chi: chi,
          nivelTensao: inc.nivelTensao || '',
          nivelTensaoComTipo: inc.nivelTensaoComTipo || '',
          estado: inc.estado || '',
          tipo: inc.tipo || '',
          tipoAgrupamento: inc.tipoAgrupamento || '',

          // Datas
          dataInicio: inc.dataInicio || '',
          dataAtribuicao: inc.dataAtribuicao || '-',
          dataInicioDeslocamento: inc.dataInicioDeslocamento || '-',
          dataChegada: inc.dataChegada || '-',
          dataFim: inc.dataFim || '-',
          duracao: inc.duracao || '00:00',
          dataPrevisaoAtendimento: inc.dataPrevisaoAtendimento || '-',
          dataEscalonamento: inc.dataEscalonamento || '-',

          // Localização
          polo: inc.polo || '',
          sucursal: inc.sucursal || '',
          conjunto: inc.conjunto || '',
          regiao: inc.regiao || '',
          municipio: inc.municipio || '',
          cd: inc.cd || '',
          alimentador: inc.alimentador || '',
          pontoEletrico: inc.pontoEletrico || '',
          latitude: inc.latitude || '',
          longitude: inc.longitude || '',

          // Clientes
          clientesAfetadosAtual: inc.clientesAfetadosAtual || 0,
          normalizadosAbaixo3Min: inc.normalizadosAbaixo3Min || 0,
          clientesAfetadosAcima3Min: inc.clientesAfetadosAcima3Min || 0,
          afetacaoMaxima: inc.afetacaoMaxima || 0,
          conh: inc.conh || '0.00',
          clienteEssencial: inc.clienteEssencial || 0,
          totalAvisos: inc.totalAvisos || 0,
          numeroCliente: inc.numeroCliente || '',
          tipoReclamacao: inc.tipoReclamacao || '',

          // Flags
          eletrodependente: inc.eletrodependente || false,
          urgente: inc.urgente || false,
          condominio: inc.condominio || false,
          improdutiva: inc.improdutiva || false,
          reincidente: inc.reincidente || false,
          amplaChip: inc.amplaChip || false,
          energiaSolar: inc.energiaSolar || false,
          iluminacaoPublica: inc.iluminacaoPublica || false,
          areaRisco: inc.areaRisco || 'Não',

          // Causa
          causa: inc.causa || '',

          // Equipes
          equipeAtribuida: inc.equipeAtribuida || '',
          equipeDeslocada: inc.equipeDeslocada || '-',
          atribuicao: _getEquipe(inc),

          // Tempos
          tmp: inc.tmp || 0,
          tmd: inc.tmd || 0,
          tme: inc.tme || 0,
          tma: inc.tma || 0,
          tempoParaManobra: inc.tempoParaManobra || 0,
          tempoPreparacao: inc.tempoPreparacao || '00:00:00',
          tempoDeslocamento: inc.tempoDeslocamento || '00:00:00',
          tempoExecucao: inc.tempoExecucao || '00:00:00',
          tempoAtendimento: inc.tempoAtendimento || '00:00:00',
          tempoAgrupado: inc.tempoAgrupado || '',

          // Compensação
          compensacao: inc.compensacao || 0,
          nivelCompensasao: inc.nivelCompensasao || '',
          valorCompensacao: inc.valorCompensacao || 0,

          // Callback / URA / BOT
          callback: inc.callback || '',
          retornoCallback: inc.retornoCallback || '-',
          resultadoLigacaoCallback: inc.resultadoLigacaoCallback || '-',
          motivoCallback: inc.motivoCallback || '-',
          statusURA: inc.statusURA || '-',
          resultadoURA: inc.resultadoURA || '',
          resultadoBOT: inc.resultadoBOT || '',
          motivoBOT: inc.motivoBOT || '-',

          // Monitor Ramal
          monitorRamal: inc.monitorRamal || '',
          alarmeMR: inc.alarmeMR || false,
          statusMonitorRamal: inc.statusMonitorRamal || '',
          inicioMR: inc.inicioMR || null,

          // Outros
          osm: inc.osm || 'Não',
          ordem2: inc.ordem2 || 'Não',
          cumpreRegrasOuro: inc.cumpreRegrasOuro || 'Não',
          convergencia: inc.convergencia || null,
          pontoAtencao: inc.pontoAtencao || '-',
          periodo: inc.periodo || '',
          operador: inc.operador || '',
          numerosAvisos: inc.numerosAvisos || '',
          numerosProtocolos: inc.numerosProtocolos || '',
          observacao: inc.observacao || ''
        };

        if (clientes.length === 0) {
          // Sem clientes críticos: 1 linha com campos CC vazios
          baseRow.ccUc = '—';
          baseRow.ccNome = '—';
          baseRow.ccSegmento = '—';
          baseRow.ccCriticidade = '—';
          baseRow.ccAviso = '—';
          result.push(baseRow);
        } else {
          // 1 linha por cliente crítico, repetindo os dados da incidência
          clientes.forEach(function (c) {
            var row = angular.copy(baseRow);
            row.ccUc = c.uc || '—';
            row.ccNome = c.nome || '—';
            row.ccSegmento = c.segmento || '—';
            row.ccCriticidade = c.criticidade != null ? c.criticidade : '—';
            row.ccAviso = c.aviso || '—';
            result.push(row);
          });
        }
      });
      return result;
    }

    /** Helper: obter equipe prioridade deslocada > atribuída */
    function _getEquipe(inc) {
      return (inc.equipeDeslocada && inc.equipeDeslocada !== '-' ? inc.equipeDeslocada : null) || inc.equipeAtribuida || '-';
    }

    // ═══════════════════════════════════════════════════════
    // INCIDÊNCIAS
    // ═══════════════════════════════════════════════════════

    /**
     * Processa array bruto de incidências e retorna objeto com
     * panorama, totals, kpis, top10Chi, top10Tma, top10Cli e debugInfo.
     *
     * @param {Array}  items                  - Incidências brutas da API
     * @param {Object} [eletrodepPorConjunto] - contagem eletrodep por conjunto (do cruzamento)
     * @param {number} [totalEletrodep]       - total geral de eletrodependentes
     * @param {Object} [avisoPorConjunto]     - conjuntos com aviso ativo
     * @returns {Object}
     */
    function processIncidencias(items, eletrodepPorConjunto, totalEletrodep, avisoPorConjunto) {
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

      eletrodepPorConjunto = eletrodepPorConjunto || {};
      totalEletrodep = totalEletrodep || 0;
      avisoPorConjunto = avisoPorConjunto || {};

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
      var panorama = buildPanorama(active, eletrodepPorConjunto, avisoPorConjunto);

      // ── Totals ──
      var totals = buildTotals(panorama);

      // ── KPIs ──
      var kpis = buildKpis(active, totals, totalEletrodep);

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

    function buildPanorama(active, eletrodepPorConjunto, avisoPorConjunto) {
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

        var eq = _getEquipe(inc);
        if (eq === '-') {
          g.naoDespachados++;
        } else {
          g.equipesObj[eq] = true;
          var eqUpper = eq.toUpperCase();
          if (_tagsExtras.some(function (tag) { return eqUpper.indexOf(tag) >= 0; })) {
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

      // Converter para array e injetar eletrodep do cruzamento
      var list = [];
      var keys = Object.keys(groups);
      for (var k = 0; k < keys.length; k++) {
        var g = groups[keys[k]];
        var eqCount = Object.keys(g.equipesObj).length;
        var eq2Count = Object.keys(g.equipes2RecObj).length;

        // Eletrodep = incidências c/ flag true + clientes Vital do cruzamento
        var eletrodepCount = g.eletrodependente + (eletrodepPorConjunto[g.conjunto] || 0);
        var temAviso = !!avisoPorConjunto[g.conjunto];

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
          eletrodependente: eletrodepCount,
          temAviso: temAviso,
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
        temAviso: false,
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
        if (r.temAviso) t.temAviso = true;
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

    function buildKpis(active, totals, totalEletrodep) {
      var urgCount = 0;
      var chiTotal = 0;

      active.forEach(function (inc) {
        if (inc.urgente === true || inc.urgente === 'true') urgCount++;
        chiTotal += (inc.clientesAfetadosAtual || 0) * H.parseDuracao(inc.duracao);
      });

      return {
        totalIncidencias: totals.incidenciasAtivas,
        totalClientes: totals.clientesAfetados,
        totalEquipes: 0, // será atualizado pelas equipes
        naoDespachados: totals.naoDespachados,
        urgentes: urgCount,
        eletrodependentes: totals.eletrodependente,
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
        return _tagsExtras.some(function (tag) { return nome.indexOf(tag) >= 0; });
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
