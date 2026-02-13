/**
 * NorthRadar — Bootstrap (Composition Root)
 *
 * Ponto de entrada que monta o grafo de dependências DDD:
 *   Domain  →  Infrastructure  →  Application  →  Presentation
 *
 * Uso: node src/main.js
 */

// ── Infrastructure ──
const PuppeteerAuthProvider = require('./infrastructure/auth/PuppeteerAuthProvider');
const OperviewIncidenceRepository = require('./infrastructure/repositories/OperviewIncidenceRepository');

// ── Application ──
const FetchIncidences = require('./application/use-cases/FetchIncidences');
const Scheduler = require('./application/use-cases/Scheduler');

// ── Presentation ──
const WebServer = require('./presentation/web/server');

// ── Config ──
const config = require('./config');

// ═══════════════════════════════════════════════════
//  Instanciar dependências (Composition Root)
// ═══════════════════════════════════════════════════
const authProvider = new PuppeteerAuthProvider();
const incidenceRepo = new OperviewIncidenceRepository(authProvider);
const fetchIncidencesUC = new FetchIncidences(incidenceRepo);

// Scheduler: refresh a cada 60 min (config ou padrão)
const REFRESH_INTERVAL = 60 * 60 * 1000; // 60 min
const scheduler = new Scheduler(fetchIncidencesUC, REFRESH_INTERVAL);

// Web server
const PORT = process.env.PORT || 3000;
const webServer = new WebServer(scheduler, PORT, authProvider);

// ═══════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  NorthRadar — DDD Architecture                                  ║
║  Integração com Operview API                                     ║
╚══════════════════════════════════════════════════════════════════╝
`);

  try {
    // 1. Autenticação
    console.log('[Main] 1/3 — Inicializando autenticação...');
    const token = await authProvider.initialize();
    console.log(`[Main]     Token: ${token.substring(0, 50)}...`);

    // 2. Scheduler (primeira carga + auto-refresh)
    console.log('[Main] 2/3 — Iniciando scheduler (refresh 60 min)...');
    await scheduler.start();

    // 3. Web server
    console.log('[Main] 3/3 — Iniciando servidor web...');
    await webServer.start();

    console.log('\n[Main] ✅ Tudo pronto! Ctrl+C para encerrar.\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[Main] Encerrando...');
      scheduler.stop();
      await webServer.stop();
      await authProvider.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error('[Main] ❌ Erro fatal:', error.message);
    scheduler.stop();
    await authProvider.shutdown();
    process.exit(1);
  }
}

// Exportar para uso como módulo
module.exports = { authProvider, scheduler, webServer };

// Executar se chamado diretamente
if (require.main === module) {
  main();
}
