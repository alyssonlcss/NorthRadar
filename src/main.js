/**
 * NorthRadar — Bootstrap
 *
 * Ponto de entrada que monta as dependências e inicia a aplicação.
 *
 * Uso: node src/main.js
 */

// ── Config ──
const config = require('./config');
const Logger = require('./shared/Logger');

// ── Modules ──
const PuppeteerAuthProvider = require('./modules/auth/PuppeteerAuthProvider');
const IncidenceRepository = require('./modules/incidences/IncidenceRepository');
const IncidenceService = require('./modules/incidences/IncidenceService');
const SpotfireProvider = require('./modules/deslocamentos/SpotfireProvider');
const DeslocamentoRepository = require('./modules/deslocamentos/DeslocamentoRepository');
const DeslocamentoService = require('./modules/deslocamentos/DeslocamentoService');

// ── Server ──
const ExpressServer = require('./server/ExpressServer');

// ── Logger ──
const logger = Logger.create('Main');

// ── Segurança em runtime (especialmente em debug / Node 22) ──
// Em algumas execuções (ex.: VS Code debug), rejections não tratadas podem derrubar o processo.
// Aqui garantimos que um erro de request (Spotfire instável / DOM) não mate o servidor.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error(`UnhandledRejection: ${msg}`);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});

process.on('uncaughtException', (err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  logger.error(`UncaughtException: ${msg}`);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});

// ═══════════════════════════════════════════════════
//  Montar dependências
// ═══════════════════════════════════════════════════
const authProvider = new PuppeteerAuthProvider();
const incidenceRepo = new IncidenceRepository(authProvider);

const REFRESH_INTERVAL = 60 * 60 * 1000; // 60 min
const incidenceService = new IncidenceService(incidenceRepo, REFRESH_INTERVAL);

const spotfireProvider = new SpotfireProvider();
const deslocamentoRepo = new DeslocamentoRepository(spotfireProvider);
const deslocamentoService = new DeslocamentoService(
  deslocamentoRepo,
  spotfireProvider,
  config.spotfire.polos,
  config.spotfire.refreshIntervalMs,
);

const PORT = process.env.PORT || 3000;
const webServer = new ExpressServer({ incidenceService, authProvider, deslocamentoService }, PORT);

// ═══════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  NorthRadar — Modular Architecture                               ║
║  Integração com Operview API                                     ║
╚══════════════════════════════════════════════════════════════════╝
`);

  try {
    // 1. Autenticação
    logger.info('1/4 — Inicializando autenticação...');
    const token = await authProvider.initialize();
    logger.info(`    Token: ${token.substring(0, 50)}...`);

    // 2. Incidences (primeira carga + auto-refresh)
    logger.info('2/4 — Iniciando scheduler de incidências (refresh 60 min)...');
    await incidenceService.startScheduler();

    // 3. Deslocamentos Spotfire (primeira carga + auto-refresh)
    logger.info('3/4 — Iniciando scheduler de deslocamentos Spotfire...');
    deslocamentoService.startScheduler().catch((err) => {
      logger.warn(`Scheduler de deslocamentos falhou na inicialização (continuando sem Spotfire): ${err.message}`);
    });

    // 4. Web server
    logger.info('4/4 — Iniciando servidor web...');
    await webServer.start();

    logger.info('✅ Tudo pronto! Ctrl+C para encerrar.\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Encerrando...');
      incidenceService.stopScheduler();
      await deslocamentoService.shutdown();
      await webServer.stop();
      await authProvider.shutdown();
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Erro fatal: ${error.message}`);
    incidenceService.stopScheduler();
    await deslocamentoService.shutdown().catch(() => {});
    await authProvider.shutdown();
    process.exit(1);
  }
}

// Exportar para uso como módulo
module.exports = { authProvider, incidenceService, deslocamentoService, webServer };

// Executar se chamado diretamente
if (require.main === module) {
  main();
}
