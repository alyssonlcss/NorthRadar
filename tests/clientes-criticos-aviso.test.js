/**
 * NorthRadar – Testes: Cenários de Clientes Críticos com Aviso
 *
 * Cobre toda a lógica de:
 *   1. Cruzamento de clientes críticos (cruzarClientesCriticos)
 *   2. Detecção de avisos ativos (avisoPorConjunto)
 *   3. Contagem de eletrodependentes (segmento Vital)
 *   4. Filtragem no popup (filtrarIncidenciasPorContexto)
 *   5. Panorama com flag temAviso
 *   6. Enriquecimento de linhas com dados CC (ccAviso, ccSegmento, etc.)
 */
'use strict';

const {
  cruzarClientesCriticos,
  filtrarIncidenciasPorContexto,
  buildPanorama,
  parseDuracao,
  isActive,
} = require('./helpers/processor-standalone');

// ═══════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════

/** Cria uma incidência ativa com valores padrão. */
function makeIncidencia(overrides) {
  return Object.assign({
    numero: 'INC-001',
    estado: 'ACTIVO',
    dataFim: '-',
    conjunto: 'FORTALEZA',
    polo: 'ATLANTICO',
    regiao: 'REGIÃO NORTE',
    clientesAfetadosAtual: 100,
    duracao: '02:00',
    totalAvisos: 0,
    clienteEssencial: 0,
    eletrodependente: false,
    urgente: false,
    equipeAtribuida: 'EQ-01',
    equipeDeslocada: '-',
    nivelTensao: 'BT',
    alimentador: 'ALM-01',
    cd: 'CD-01',
  }, overrides);
}

/** Cria um cliente crítico com valores padrão. */
function makeClienteCritico(overrides) {
  return Object.assign({
    incidencia: 'INC-001',
    uc: '123456',
    nome: 'Hospital São José',
    segmento: 'Vital',
    criticidade: 1,
    aviso: null,
  }, overrides);
}

// ═══════════════════════════════════════════════════════
// 1. CRUZAMENTO DE CLIENTES CRÍTICOS
// ═══════════════════════════════════════════════════════

describe('cruzarClientesCriticos', () => {

  test('retorna estrutura vazia quando não há clientes críticos', () => {
    const incidencias = [makeIncidencia()];
    const result = cruzarClientesCriticos([], incidencias);

    expect(result.clientesPorIncidencia).toEqual({});
    expect(result.eletrodepPorConjunto).toEqual({});
    expect(result.avisoPorConjunto).toEqual({});
    expect(result.totalEletrodep).toBe(0);
  });

  test('retorna estrutura vazia quando ambos os inputs são vazios', () => {
    const result = cruzarClientesCriticos([], []);

    expect(result.clientesPorIncidencia).toEqual({});
    expect(result.totalEletrodep).toBe(0);
  });

  test('trata null como lista vazia de clientes', () => {
    const incidencias = [makeIncidencia()];
    const result = cruzarClientesCriticos(null, incidencias);

    expect(result.clientesPorIncidencia).toEqual({});
    expect(result.totalEletrodep).toBe(0);
  });

  test('indexa clientes por numero de incidência', () => {
    const inc1 = makeIncidencia({ numero: 'INC-001' });
    const inc2 = makeIncidencia({ numero: 'INC-002' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', uc: 'A' }),
      makeClienteCritico({ incidencia: 'INC-001', uc: 'B' }),
      makeClienteCritico({ incidencia: 'INC-002', uc: 'C' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc1, inc2]);

    expect(result.clientesPorIncidencia['INC-001']).toHaveLength(2);
    expect(result.clientesPorIncidencia['INC-002']).toHaveLength(1);
  });

  test('ignora clientes sem incidencia definida', () => {
    const inc1 = makeIncidencia({ numero: 'INC-001' });
    const clientes = [
      makeClienteCritico({ incidencia: '', uc: 'X' }),
      makeClienteCritico({ incidencia: null, uc: 'Y' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc1]);
    expect(Object.keys(result.clientesPorIncidencia)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// 2. DETECÇÃO DE AVISOS ATIVOS (avisoPorConjunto)
// ═══════════════════════════════════════════════════════

describe('cruzarClientesCriticos – avisoPorConjunto', () => {

  test('marca conjunto como tendo aviso quando cliente tem aviso não-vazio', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: 'AV-98765' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['FORTALEZA']).toBe(true);
  });

  test('NÃO marca aviso quando aviso é null', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: null }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['FORTALEZA']).toBeUndefined();
  });

  test('NÃO marca aviso quando aviso é string vazia', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: '' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['FORTALEZA']).toBeUndefined();
  });

  test('NÃO marca aviso quando aviso é "-"', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: '-' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['FORTALEZA']).toBeUndefined();
  });

  test('marca aviso quando pelo menos 1 cliente do conjunto tem aviso (mesmo que outros não)', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'METROPOLITAN' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: null, uc: 'SEM' }),
      makeClienteCritico({ incidencia: 'INC-001', aviso: 'AV-111', uc: 'COM' }),
      makeClienteCritico({ incidencia: 'INC-001', aviso: '-', uc: 'DASH' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['METROPOLITAN']).toBe(true);
  });

  test('marca avisos para múltiplos conjuntos independentemente', () => {
    const inc1 = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const inc2 = makeIncidencia({ numero: 'INC-002', conjunto: 'CAUCAIA' });
    const inc3 = makeIncidencia({ numero: 'INC-003', conjunto: 'MARACANAÚ' });

    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: 'AV-100' }),
      makeClienteCritico({ incidencia: 'INC-002', aviso: null }),
      makeClienteCritico({ incidencia: 'INC-003', aviso: 'AV-300' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc1, inc2, inc3]);

    expect(result.avisoPorConjunto['FORTALEZA']).toBe(true);
    expect(result.avisoPorConjunto['CAUCAIA']).toBeUndefined();
    expect(result.avisoPorConjunto['MARACANAÚ']).toBe(true);
  });

  test('usa "N/A" como conjunto quando incidência não é encontrada no mapa', () => {
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-INEXISTENTE', aviso: 'AV-999' }),
    ];

    const result = cruzarClientesCriticos(clientes, []);
    expect(result.avisoPorConjunto['N/A']).toBe(true);
  });

  test('usa "N/A" como conjunto quando incidência tem conjunto vazio', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: '' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: 'AV-456' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['N/A']).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// 3. CONTAGEM DE ELETRODEPENDENTES (segmento Vital)
// ═══════════════════════════════════════════════════════

describe('cruzarClientesCriticos – eletrodependentes', () => {

  test('conta apenas clientes com segmento "Vital"', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'Vital' }),
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'Essencial' }),
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'Vital' }),
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'Normal' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);

    expect(result.totalEletrodep).toBe(2);
    expect(result.eletrodepPorConjunto['FORTALEZA']).toBe(2);
  });

  test('não conta segmento "vital" (case-sensitive)', () => {
    const inc = makeIncidencia({ numero: 'INC-001' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'vital' }),
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'VITAL' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.totalEletrodep).toBe(0);
  });

  test('distribui eletrodep por conjunto corretamente', () => {
    const inc1 = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const inc2 = makeIncidencia({ numero: 'INC-002', conjunto: 'CAUCAIA' });

    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'Vital' }),
      makeClienteCritico({ incidencia: 'INC-001', segmento: 'Vital' }),
      makeClienteCritico({ incidencia: 'INC-002', segmento: 'Vital' }),
      makeClienteCritico({ incidencia: 'INC-002', segmento: 'Normal' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc1, inc2]);

    expect(result.eletrodepPorConjunto['FORTALEZA']).toBe(2);
    expect(result.eletrodepPorConjunto['CAUCAIA']).toBe(1);
    expect(result.totalEletrodep).toBe(3);
  });

  test('cliente Vital COM aviso é contado em eletrodep E aviso', () => {
    const inc = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA' });
    const clientes = [
      makeClienteCritico({
        incidencia: 'INC-001',
        segmento: 'Vital',
        aviso: 'AV-12345',
      }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);

    expect(result.totalEletrodep).toBe(1);
    expect(result.eletrodepPorConjunto['FORTALEZA']).toBe(1);
    expect(result.avisoPorConjunto['FORTALEZA']).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// 4. FILTRAGEM NO POPUP – CONTEXTO ELETRODEPENDENTE
// ═══════════════════════════════════════════════════════

describe('filtrarIncidenciasPorContexto – eletrodependente com aviso', () => {

  test('card/eletrodependente: inclui incidência com flag eletrodependente=true', () => {
    const inc = makeIncidencia({ eletrodependente: true });
    const clientesPorInc = {};

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'eletrodependente' },
      [inc],
      clientesPorInc
    );

    expect(result).toHaveLength(1);
    expect(result[0].numero).toBe('INC-001');
  });

  test('card/eletrodependente: inclui incidência sem flag mas com cliente Vital', () => {
    const inc = makeIncidencia({ eletrodependente: false });
    const clientesPorInc = {
      'INC-001': [makeClienteCritico({ segmento: 'Vital' })],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'eletrodependente' },
      [inc],
      clientesPorInc
    );

    expect(result).toHaveLength(1);
  });

  test('card/eletrodependente: exclui incidência sem flag e sem cliente Vital', () => {
    const inc = makeIncidencia({ eletrodependente: false });
    const clientesPorInc = {
      'INC-001': [makeClienteCritico({ segmento: 'Essencial' })],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'eletrodependente' },
      [inc],
      clientesPorInc
    );

    expect(result).toHaveLength(0);
  });

  test('card/eletrodependente: exclui incidências encerradas', () => {
    const inc = makeIncidencia({
      eletrodependente: true,
      estado: 'ENCERRADO',
      dataFim: '2026-01-15 10:00',
    });

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'eletrodependente' },
      [inc],
      {}
    );

    expect(result).toHaveLength(0);
  });

  test('panorama/eletrodependente: filtra por conjunto + segmento Vital', () => {
    const inc1 = makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA', eletrodependente: false });
    const inc2 = makeIncidencia({ numero: 'INC-002', conjunto: 'FORTALEZA', eletrodependente: false });
    const inc3 = makeIncidencia({ numero: 'INC-003', conjunto: 'CAUCAIA', eletrodependente: false });

    const clientesPorInc = {
      'INC-001': [makeClienteCritico({ segmento: 'Vital', aviso: 'AV-111' })],
      'INC-002': [makeClienteCritico({ segmento: 'Normal' })],
      'INC-003': [makeClienteCritico({ segmento: 'Vital', aviso: 'AV-222' })],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'panorama', campo: 'eletrodependente', valor: 'FORTALEZA' },
      [inc1, inc2, inc3],
      clientesPorInc
    );

    // Apenas INC-001 é de FORTALEZA + Vital
    expect(result).toHaveLength(1);
    expect(result[0].numero).toBe('INC-001');
    expect(result[0].ccAviso).toBe('AV-111');
  });
});

// ═══════════════════════════════════════════════════════
// 5. ENRIQUECIMENTO DE LINHAS COM DADOS CC
// ═══════════════════════════════════════════════════════

describe('filtrarIncidenciasPorContexto – enriquecimento de campos CC', () => {

  test('incidência sem clientes críticos recebe CC com "—"', () => {
    const inc = makeIncidencia();
    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'totalIncidencias' },
      [inc],
      {}
    );

    expect(result).toHaveLength(1);
    expect(result[0].ccUc).toBe('—');
    expect(result[0].ccNome).toBe('—');
    expect(result[0].ccSegmento).toBe('—');
    expect(result[0].ccCriticidade).toBe('—');
    expect(result[0].ccAviso).toBe('—');
  });

  test('incidência com 1 cliente crítico com aviso gera 1 linha enriquecida', () => {
    const inc = makeIncidencia();
    const clientesPorInc = {
      'INC-001': [
        makeClienteCritico({
          uc: '999888',
          nome: 'Hospital Central',
          segmento: 'Vital',
          criticidade: 1,
          aviso: 'AV-55555',
        }),
      ],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'totalIncidencias' },
      [inc],
      clientesPorInc
    );

    expect(result).toHaveLength(1);
    expect(result[0].ccUc).toBe('999888');
    expect(result[0].ccNome).toBe('Hospital Central');
    expect(result[0].ccSegmento).toBe('Vital');
    expect(result[0].ccCriticidade).toBe(1);
    expect(result[0].ccAviso).toBe('AV-55555');
  });

  test('incidência com N clientes gera N linhas (uma por cliente)', () => {
    const inc = makeIncidencia();
    const clientesPorInc = {
      'INC-001': [
        makeClienteCritico({ uc: 'A', aviso: 'AV-1' }),
        makeClienteCritico({ uc: 'B', aviso: null }),
        makeClienteCritico({ uc: 'C', aviso: 'AV-3' }),
      ],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'totalIncidencias' },
      [inc],
      clientesPorInc
    );

    expect(result).toHaveLength(3);
    expect(result[0].ccUc).toBe('A');
    expect(result[0].ccAviso).toBe('AV-1');
    expect(result[1].ccUc).toBe('B');
    expect(result[1].ccAviso).toBe('—');  // null se torna '—'
    expect(result[2].ccUc).toBe('C');
    expect(result[2].ccAviso).toBe('AV-3');
  });

  test('criticidade 0 é preservada (não mapeada para "—")', () => {
    const inc = makeIncidencia();
    const clientesPorInc = {
      'INC-001': [makeClienteCritico({ criticidade: 0 })],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'totalIncidencias' },
      [inc],
      clientesPorInc
    );

    expect(result[0].ccCriticidade).toBe(0);
  });

  test('campos CC vazios recebem "—" como fallback', () => {
    const inc = makeIncidencia();
    const clientesPorInc = {
      'INC-001': [
        makeClienteCritico({
          uc: '',
          nome: '',
          segmento: '',
          criticidade: null,
          aviso: '',
        }),
      ],
    };

    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'totalIncidencias' },
      [inc],
      clientesPorInc
    );

    expect(result[0].ccUc).toBe('—');
    expect(result[0].ccNome).toBe('—');
    expect(result[0].ccSegmento).toBe('—');
    expect(result[0].ccCriticidade).toBe('—');
    expect(result[0].ccAviso).toBe('—');
  });
});

// ═══════════════════════════════════════════════════════
// 6. PANORAMA – FLAG temAviso
// ═══════════════════════════════════════════════════════

describe('buildPanorama – temAviso', () => {

  test('panorama inclui temAviso=true quando avisoPorConjunto marca o conjunto', () => {
    const active = [makeIncidencia({ conjunto: 'FORTALEZA' })];
    const eletrodepPorConjunto = {};
    const avisoPorConjunto = { FORTALEZA: true };

    const panorama = buildPanorama(active, eletrodepPorConjunto, avisoPorConjunto);

    expect(panorama).toHaveLength(1);
    expect(panorama[0].temAviso).toBe(true);
  });

  test('panorama inclui temAviso=false quando conjunto não tem aviso', () => {
    const active = [makeIncidencia({ conjunto: 'FORTALEZA' })];
    const eletrodepPorConjunto = {};
    const avisoPorConjunto = {};

    const panorama = buildPanorama(active, eletrodepPorConjunto, avisoPorConjunto);

    expect(panorama).toHaveLength(1);
    expect(panorama[0].temAviso).toBe(false);
  });

  test('panorama: múltiplos conjuntos com temAviso diferentes', () => {
    const active = [
      makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA', clientesAfetadosAtual: 50 }),
      makeIncidencia({ numero: 'INC-002', conjunto: 'CAUCAIA', clientesAfetadosAtual: 30 }),
      makeIncidencia({ numero: 'INC-003', conjunto: 'MARACANAÚ', clientesAfetadosAtual: 10 }),
    ];
    const avisoPorConjunto = { FORTALEZA: true, MARACANAÚ: true };

    const panorama = buildPanorama(active, {}, avisoPorConjunto);

    const fortMap = panorama.find(p => p.conjunto === 'FORTALEZA');
    const caucMap = panorama.find(p => p.conjunto === 'CAUCAIA');
    const maraMap = panorama.find(p => p.conjunto === 'MARACANAÚ');

    expect(fortMap.temAviso).toBe(true);
    expect(caucMap.temAviso).toBe(false);
    expect(maraMap.temAviso).toBe(true);
  });

  test('panorama soma eletrodep incidencias + cruzamento corretamente', () => {
    const active = [
      makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA', eletrodependente: true }),
      makeIncidencia({ numero: 'INC-002', conjunto: 'FORTALEZA', eletrodependente: false }),
    ];
    const eletrodepPorConjunto = { FORTALEZA: 3 }; // 3 clientes Vital do cruzamento
    const avisoPorConjunto = { FORTALEZA: true };

    const panorama = buildPanorama(active, eletrodepPorConjunto, avisoPorConjunto);
    const fort = panorama.find(p => p.conjunto === 'FORTALEZA');

    // 1 flag incidência + 3 clientes Vital = 4
    expect(fort.eletrodependente).toBe(4);
    expect(fort.temAviso).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// 7. CENÁRIO INTEGRADO END-TO-END
// ═══════════════════════════════════════════════════════

describe('Cenário integrado: clientes críticos com aviso', () => {

  const incidencias = [
    makeIncidencia({ numero: 'INC-001', conjunto: 'FORTALEZA', clientesAfetadosAtual: 500, duracao: '04:00', eletrodependente: false }),
    makeIncidencia({ numero: 'INC-002', conjunto: 'FORTALEZA', clientesAfetadosAtual: 200, duracao: '01:00', eletrodependente: true }),
    makeIncidencia({ numero: 'INC-003', conjunto: 'CAUCAIA', clientesAfetadosAtual: 100, duracao: '10:00', eletrodependente: false }),
    makeIncidencia({ numero: 'INC-004', conjunto: 'CAUCAIA', clientesAfetadosAtual: 50, duracao: '25:00', eletrodependente: false }),
  ];

  const clientesCriticos = [
    // INC-001: 2 clientes Vital, 1 com aviso
    makeClienteCritico({ incidencia: 'INC-001', uc: 'H001', nome: 'Hospital A', segmento: 'Vital', aviso: 'AV-001' }),
    makeClienteCritico({ incidencia: 'INC-001', uc: 'H002', nome: 'Hospital B', segmento: 'Vital', aviso: null }),
    // INC-002: 1 cliente Essencial sem aviso (já tem flag eletrodep)
    makeClienteCritico({ incidencia: 'INC-002', uc: 'E001', nome: 'Escola X', segmento: 'Essencial', aviso: '-' }),
    // INC-003: 1 cliente Vital com aviso
    makeClienteCritico({ incidencia: 'INC-003', uc: 'H003', nome: 'UTI Central', segmento: 'Vital', aviso: 'AV-300' }),
    // INC-004: sem clientes críticos
  ];

  let cruzamento;

  beforeAll(() => {
    cruzamento = cruzarClientesCriticos(clientesCriticos, incidencias);
  });

  test('totalEletrodep conta apenas Vital: 3', () => {
    expect(cruzamento.totalEletrodep).toBe(3);
  });

  test('eletrodepPorConjunto: FORTALEZA=2, CAUCAIA=1', () => {
    expect(cruzamento.eletrodepPorConjunto['FORTALEZA']).toBe(2);
    expect(cruzamento.eletrodepPorConjunto['CAUCAIA']).toBe(1);
  });

  test('avisoPorConjunto: FORTALEZA=true, CAUCAIA=true', () => {
    expect(cruzamento.avisoPorConjunto['FORTALEZA']).toBe(true);
    expect(cruzamento.avisoPorConjunto['CAUCAIA']).toBe(true);
  });

  test('INC-001 tem 2 clientes no mapeamento', () => {
    expect(cruzamento.clientesPorIncidencia['INC-001']).toHaveLength(2);
  });

  test('INC-004 não tem clientes no mapeamento', () => {
    expect(cruzamento.clientesPorIncidencia['INC-004']).toBeUndefined();
  });

  test('panorama reflete eletrodep do cruzamento + flag + temAviso', () => {
    const panorama = buildPanorama(
      incidencias,
      cruzamento.eletrodepPorConjunto,
      cruzamento.avisoPorConjunto
    );

    const fort = panorama.find(p => p.conjunto === 'FORTALEZA');
    const cauc = panorama.find(p => p.conjunto === 'CAUCAIA');

    // FORTALEZA: 1 flag eletrodependente (INC-002) + 2 Vital do cruzamento = 3
    expect(fort.eletrodependente).toBe(3);
    expect(fort.temAviso).toBe(true);

    // CAUCAIA: 0 flag + 1 Vital = 1
    expect(cauc.eletrodependente).toBe(1);
    expect(cauc.temAviso).toBe(true);
  });

  test('popup eletrodependente filtra corretamente e enriquece com CC', () => {
    const result = filtrarIncidenciasPorContexto(
      { tipo: 'card', campo: 'eletrodependente' },
      incidencias,
      cruzamento.clientesPorIncidencia
    );

    // INC-001 (2 clientes Vital → 2 linhas) + INC-002 (flag=true, 1 cliente → 1 linha)
    //   + INC-003 (1 cliente Vital → 1 linha) = 4 linhas
    const numeros = result.map(r => r.numero);
    expect(numeros).toContain('INC-001');
    expect(numeros).toContain('INC-002');
    expect(numeros).toContain('INC-003');
    expect(numeros).not.toContain('INC-004');

    // Verificar dados CC do aviso no INC-001
    const inc001Rows = result.filter(r => r.numero === 'INC-001');
    expect(inc001Rows).toHaveLength(2);

    const comAviso = inc001Rows.find(r => r.ccAviso === 'AV-001');
    expect(comAviso).toBeDefined();
    expect(comAviso.ccSegmento).toBe('Vital');
    expect(comAviso.ccNome).toBe('Hospital A');

    const semAviso = inc001Rows.find(r => r.ccUc === 'H002');
    expect(semAviso.ccAviso).toBe('—');
  });

  test('popup panorama FORTALEZA/eletrodependente mostra apenas incidências do conjunto', () => {
    const result = filtrarIncidenciasPorContexto(
      { tipo: 'panorama', campo: 'eletrodependente', valor: 'FORTALEZA' },
      incidencias,
      cruzamento.clientesPorIncidencia
    );

    const numeros = [...new Set(result.map(r => r.numero))];
    expect(numeros).toContain('INC-001');
    expect(numeros).toContain('INC-002');
    expect(numeros).not.toContain('INC-003');
    expect(numeros).not.toContain('INC-004');
  });
});

// ═══════════════════════════════════════════════════════
// 8. EDGE CASES
// ═══════════════════════════════════════════════════════

describe('Edge cases de clientes críticos com aviso', () => {

  test('mesmo cliente com múltiplos avisos em incidências diferentes', () => {
    const inc1 = makeIncidencia({ numero: 'INC-001', conjunto: 'A' });
    const inc2 = makeIncidencia({ numero: 'INC-002', conjunto: 'B' });

    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', uc: 'SAME', aviso: 'AV-1', segmento: 'Vital' }),
      makeClienteCritico({ incidencia: 'INC-002', uc: 'SAME', aviso: 'AV-2', segmento: 'Vital' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc1, inc2]);

    expect(result.totalEletrodep).toBe(2);
    expect(result.avisoPorConjunto['A']).toBe(true);
    expect(result.avisoPorConjunto['B']).toBe(true);
  });

  test('cliente com aviso numérico (número como string) é detectado', () => {
    const inc = makeIncidencia({ numero: 'INC-001' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: '12345' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['FORTALEZA']).toBe(true);
  });

  test('cliente com aviso contendo espaços é detectado', () => {
    const inc = makeIncidencia({ numero: 'INC-001' });
    const clientes = [
      makeClienteCritico({ incidencia: 'INC-001', aviso: '  AV-123  ' }),
    ];

    const result = cruzarClientesCriticos(clientes, [inc]);
    expect(result.avisoPorConjunto['FORTALEZA']).toBe(true);
  });

  test('grande volume: 1000 clientes com avisos processados corretamente', () => {
    const incidencias = [];
    const clientes = [];

    for (let i = 0; i < 100; i++) {
      incidencias.push(makeIncidencia({
        numero: `INC-${i}`,
        conjunto: `CONJ-${i % 10}`,
      }));
    }

    for (let i = 0; i < 1000; i++) {
      const incIdx = i % 100;
      clientes.push(makeClienteCritico({
        incidencia: `INC-${incIdx}`,
        segmento: i % 3 === 0 ? 'Vital' : 'Normal',
        aviso: i % 5 === 0 ? `AV-${i}` : null,
      }));
    }

    const result = cruzarClientesCriticos(clientes, incidencias);

    // 1000/3 ≈ 334 Vitais (every 3rd, indices 0,3,6,...)
    const expectedVital = clientes.filter(c => c.segmento === 'Vital').length;
    expect(result.totalEletrodep).toBe(expectedVital);

    // Avisos em todos os 10 conjuntos (indices 0,5,10,... match every conjunction)
    const conjuntosComAviso = Object.keys(result.avisoPorConjunto).length;
    expect(conjuntosComAviso).toBeGreaterThan(0);
    expect(conjuntosComAviso).toBeLessThanOrEqual(10);
  });
});
