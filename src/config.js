/**
 * NorthRadar - Configuração Centralizada
 * Carrega variáveis do .env e exporta configurações tipadas
 */

require('dotenv').config();

const config = {
  // Operview API
  operview: {
    clientId: process.env.OPERVIEW_CLIENT_ID,
    domainApi: process.env.OPERVIEW_DOMAIN_API,
    syncApi: process.env.OPERVIEW_SYNC_API,
    syncAuthKey: process.env.OPERVIEW_SYNC_AUTH_KEY,
  },

  // Azure AD
  azure: {
    tenantId: process.env.AZURE_TENANT_ID,
    authority: process.env.AZURE_AUTHORITY,
  },

  // Browser Automation
  browser: {
    headless: process.env.HEADLESS === 'true',
    edgePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  },

  // Refresh interval em milissegundos
  refreshIntervalMs: (parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 110) * 60 * 1000,
};

module.exports = config;
