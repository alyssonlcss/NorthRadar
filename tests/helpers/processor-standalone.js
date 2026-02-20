/**
 * Standalone extraction of DashProcessor + DashHelpers logic
 * for unit testing without AngularJS.
 *
 * Mirrors the exact business logic from:
 *   - src/public/app/dash.helpers.js
 *   - src/public/app/dash.processor.factory.js
 */
'use strict';

// ═══════════════════════════════════════════════════════
// HELPERS (from dash.helpers.js)
// ═══════════════════════════════════════════════════════

function parseDuracao(dur) {
  if (!dur || dur === '-') return 0;
  var parts = String(dur).split(':');
  if (parts.length < 2) return parseFloat(dur) || 0;
  var h = parseInt(parts[0], 10) || 0;
  var m = parseInt(parts[1], 10) || 0;
  return h + (m / 60);
}

function isActive(inc) {
  var df = inc.dataFim;
  var estado = inc.estado || '';
  return estado === 'ACTIVO' && (!df || df === '-');
}

function getField(obj) {
  for (var i = 1; i < arguments.length; i++) {
    var val = obj[arguments[i]];
    if (val !== undefined && val !== null && val !== '') {
      return val;
    }
  }
  return null;
}

function mapIncidence(inc) {
  var cli = inc.clientesAfetadosAtual || 0;
  var duracaoStr = inc.duracao || '00:00';
  var duracaoHours = parseDuracao(duracaoStr);
  var chiVal = cli * duracaoHours;

  return {
    incidencia: inc.numero || '',
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

var H = { parseDuracao, isActive, mapIncidence, getField };

// ═══════════════════════════════════════════════════════
// PROCESSOR (from dash.processor.factory.js)
// ═══════════════════════════════════════════════════════

var TAGS_2REC = ['PD', 'ML', 'EP', 'LC', 'LL', 'CO', 'MP', 'IN', 'EN', 'MO', 'LV'];

function _getEquipe(inc) {
  return (inc.equipeDeslocada && inc.equipeDeslocada !== '-' ? inc.equipeDeslocada : null) || inc.equipeAtribuida || '-';
}

/**
 * Cruza clientes críticos com incidências.
 */
function cruzarClientesCriticos(clientesCriticos, incidencias) {
  var clientesPorIncidencia = {};
  var eletrodepPorConjunto = {};
  var avisoPorConjunto = {};
  var totalEletrodep = 0;

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

    if (cl.segmento === 'Vital') {
      totalEletrodep++;
      eletrodepPorConjunto[conj] = (eletrodepPorConjunto[conj] || 0) + 1;
    }

    if (cl.aviso && cl.aviso !== '' && cl.aviso !== '-') {
      avisoPorConjunto[conj] = true;
    }
  });

  return {
    clientesPorIncidencia: clientesPorIncidencia,
    eletrodepPorConjunto: eletrodepPorConjunto,
    avisoPorConjunto: avisoPorConjunto,
    totalEletrodep: totalEletrodep
  };
}

/**
 * Filtra incidências pelo contexto de clique.
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
          return cls.some(function (c) { return c.segmento === 'Vital'; });
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
          return cls.some(function (c) { return c.segmento === 'Vital'; });
        }
        if (contexto.campo === 'naoDespachados') {
          var eq = _getEquipe(inc);
          return !eq || eq === '-';
        }
        if (contexto.campo === 'qttAvisos') return true;
        if (contexto.campo === 'clEssencial') return true;
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

  // Enriquecer
  var result = [];
  filtered.forEach(function (inc) {
    var clientes = clientesPorIncidencia[inc.numero] || [];
    var duracaoHours = H.parseDuracao(inc.duracao);
    var chi = Math.round((inc.clientesAfetadosAtual || 0) * duracaoHours * 10) / 10;

    var baseRow = {
      numero: inc.numero || '',
      chi: chi,
      conjunto: inc.conjunto || '',
      clientesAfetadosAtual: inc.clientesAfetadosAtual || 0,
      eletrodependente: inc.eletrodependente || false,
      urgente: inc.urgente || false,
      totalAvisos: inc.totalAvisos || 0,
      duracao: inc.duracao || '00:00'
    };

    if (clientes.length === 0) {
      baseRow.ccUc = '—';
      baseRow.ccNome = '—';
      baseRow.ccSegmento = '—';
      baseRow.ccCriticidade = '—';
      baseRow.ccAviso = '—';
      result.push(baseRow);
    } else {
      clientes.forEach(function (c) {
        var row = Object.assign({}, baseRow);
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

/**
 * Build panorama from active incidences.
 */
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

  var list = [];
  var keys = Object.keys(groups);
  for (var k = 0; k < keys.length; k++) {
    var g = groups[keys[k]];
    var eqCount = Object.keys(g.equipesObj).length;
    var eq2Count = Object.keys(g.equipes2RecObj).length;

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

module.exports = {
  // Helpers
  parseDuracao,
  isActive,
  mapIncidence,
  getField,

  // Processor
  cruzarClientesCriticos,
  filtrarIncidenciasPorContexto,
  buildPanorama,
  TAGS_2REC,
  _getEquipe
};
