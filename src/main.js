/**
 * NorthRadar - Entry Point
 * 
 * Aplicação principal que inicializa os serviços.
 * O AuthService mantém o token JWT atualizado automaticamente.
 * 
 * Uso: node src/main.js
 */

const authService = require('./services/auth.service');

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  NorthRadar                                                      ║
║  Integração com Operview API                                     ║
╚══════════════════════════════════════════════════════════════════╝
`);

  try {
    // Inicializar autenticação
    console.log('[Main] Inicializando serviços...\n');
    const token = await authService.initialize();

    console.log('\n[Main] ═══════════════════════════════════════════════');
    console.log('[Main] Token JWT:');
    console.log(token.substring(0, 50) + '...');
    console.log('[Main] ═══════════════════════════════════════════════\n');

    // ====================================================
    // Aqui você pode adicionar outras camadas/serviços
    // Exemplo:
    //   const dataService = require('./services/data.service');
    //   await dataService.initialize(authService.getToken());
    // ====================================================

    console.log('[Main] ✅ Aplicação rodando. Ctrl+C para encerrar.\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[Main] Encerrando...');
      await authService.shutdown();
      process.exit(0);
    });

    // Manter processo vivo
    setInterval(() => {}, 1000);

  } catch (error) {
    console.error('[Main] ❌ Erro fatal:', error.message);
    await authService.shutdown();
    process.exit(1);
  }
}

// Exportar para uso como módulo
module.exports = { authService };

// Executar se chamado diretamente
if (require.main === module) {
  main();
}
