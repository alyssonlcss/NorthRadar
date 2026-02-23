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
  tagsEquipesExtras: (process.env.TAGS_EQUIPES_EXTRAS || 'PD,ML,EP,LC,LL,CO,MP,IN,EN,MO,LV')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // ── Token de acesso (lido do .env ou preenchido em runtime) ──
  tokenAccess: process.env.TOKEN_ACCESS || '',

  // ── Caminho do arquivo .env (para persistir o token) ──
  envFilePath: path.resolve(__dirname, '..', '..', '.env'),

  // ── Refresh interval em milissegundos ──
  refreshIntervalMs:
    (parseInt(process.env.REFRESH_INTERVAL_MINUTES, 10) || 110) * 60 * 1000,
};

module.exports = config;
