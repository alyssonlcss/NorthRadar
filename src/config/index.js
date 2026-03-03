/**
 * Configuração Centralizada
 *
 * Carrega variáveis do .env e exporta configurações tipadas.
 */
require('dotenv').config();

const path = require('path');

const config = {
  // ── Operview API ──
  operview: {
    clientId: process.env.OPERVIEW_CLIENT_ID,
    domainApi: process.env.OPERVIEW_DOMAIN_API,
    syncApi: process.env.OPERVIEW_SYNC_API,
    syncAuthKey: process.env.OPERVIEW_SYNC_AUTH_KEY,
  },

  // ── Azure AD ──
  azure: {
    tenantId: process.env.AZURE_TENANT_ID,
    authority: process.env.AZURE_AUTHORITY,
  },

  // ── Browser Automation ──
  browser: {
    headless: process.env.HEADLESS === 'true',
    edgePath:
      process.env.EDGE_PATH ||
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  },

  // ── Tags de equipes extras (siglas) ──
  tagsEquipesExtras: (process.env.TAGS_EQUIPES_EXTRAS || '')
    .split(',')
    .map(s => s.replace(/-/g, '').trim())
    .filter(Boolean),

  // ── Token de acesso (lido do .env ou preenchido em runtime) ──
  tokenAccess: process.env.TOKEN_ACCESS || '',

  // ── Caminho do arquivo .env (para persistir o token) ──
  envFilePath: path.resolve(__dirname, '..', '..', '.env'),

  // ── Intervalo de auto-refresh do dashboard no browser ──
  // Define com que frequência o frontend atualiza TODOS os painéis
  // (incidências, equipes e deslocamentos — tudo junto).
  // Variável: DASHBOARD_REFRESH_INTERVAL_MINUTES
  dashboardRefreshIntervalMs:
    (parseInt(process.env.DASHBOARD_REFRESH_INTERVAL_MINUTES, 10) || 15) * 60 * 1000,

  // ── Spotfire (Deslocamentos) ──
  spotfire: {
    url: process.env.SPOTFIRE_URL ||
      'http://elabziplra00.enelint.global:8090/spotfire/login.html#/',
    reportUrl: process.env.SPOTFIRE_REPORT_URL ||
      'http://elabziplra00.enelint.global:8090/spotfire/wp/analysis?file=/M300/Produtividade%20UO%20TR%20-%20CE',
    credentials: {
      username: process.env.SPOTFIRE_USERNAME || '',
      password: process.env.SPOTFIRE_PASSWORD || '',
    },
    polos: (process.env.SPOTFIRE_POLOS || 'ATLANTICO,DECEN,DNORT').split(',').map(s => s.trim()),
    headless: process.env.SPOTFIRE_HEADLESS === 'true',
    timeout: parseInt(process.env.SPOTFIRE_TIMEOUT_MS, 10) || 30000,
    // Cooldown por usuário ao trocar manualmente o filtro de polo no dashboard.
    // Impede que o Spotfire seja consultado repetidamente para o mesmo filtro.
    // Variável: DESLOCAMENTO_COOLDOWN_MINUTES
    cooldownMs:
      (parseInt(process.env.DESLOCAMENTO_COOLDOWN_MINUTES, 10) || 10) * 60 * 1000,
  },
};

module.exports = config;
