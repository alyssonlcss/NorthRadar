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

// ── Server ──
const ExpressServer = require('./server/ExpressServer');

// ── Logger ──
const logger = Logger.create('Main');

// ═══════════════════════════════════════════════════
//  Montar dependências
// ═══════════════════════════════════════════════════
const authProvider = new PuppeteerAuthProvider();
const incidenceRepo = new IncidenceRepository(authProvider);

const REFRESH_INTERVAL = 60 * 60 * 1000; // 60 min
const incidenceService = new IncidenceService(incidenceRepo, REFRESH_INTERVAL);

const PORT = process.env.PORT || 3000;
const webServer = new ExpressServer({ incidenceService, authProvider }, PORT);

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
    logger.info('1/3 — Inicializando autenticação...');
    const token = await authProvider.initialize();
    logger.info(`    Token: ${token.substring(0, 50)}...`);

    // 2. Incidences (primeira carga + auto-refresh)
    logger.info('2/3 — Iniciando scheduler (refresh 60 min)...');
    await incidenceService.startScheduler();

    // 3. Web server
    logger.info('3/3 — Iniciando servidor web...');
    await webServer.start();

    logger.info('✅ Tudo pronto! Ctrl+C para encerrar.\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Encerrando...');
      incidenceService.stopScheduler();
      await webServer.stop();
      await authProvider.shutdown();
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Erro fatal: ${error.message}`);
    incidenceService.stopScheduler();
    await authProvider.shutdown();
    process.exit(1);
  }
}

// Exportar para uso como módulo
module.exports = { authProvider, incidenceService, webServer };

// Executar se chamado diretamente
if (require.main === module) {
  main();
}
