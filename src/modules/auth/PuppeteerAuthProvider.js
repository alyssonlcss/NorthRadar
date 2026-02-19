/**
 * PuppeteerAuthProvider
 *
 * Implementação concreta de AuthProvider usando Puppeteer + Edge.
 * Intercepta o token JWT do Operview e mantém-no atualizado.
 */
const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const config = require('../../config');
const AuthProvider = require('./AuthProvider');
const Logger = require('../../shared/Logger');

class PuppeteerAuthProvider extends AuthProvider {
  constructor() {
    super();
    this._token = null;
    this._tokenExpiry = null;
    this._browser = null;
    this._refreshInterval = null;
    this._isInitialized = false;
    this._logger = Logger.create('AuthProvider');
  }

  async initialize() {
    if (this._isInitialized) return this._token;

    // 1. Tentar usar token salvo no .env
    const savedToken = config.tokenAccess;
    if (savedToken && this._isTokenValid(savedToken)) {
      this._token = savedToken;
      this._tokenExpiry = this._getTokenExpiry(savedToken);
      this._logger.info('✅ Token carregado do .env (ainda válido)');
      this._logger.info(`  Expira em: ${new Date(this._tokenExpiry).toLocaleString()}`);
      this._startAutoRefresh();
      this._isInitialized = true;
      return this._token;
    }

    if (savedToken) {
      this._logger.warn('Token no .env expirado — autenticando via browser...');
    } else {
      this._logger.info('Nenhum token salvo — autenticando via browser...');
    }

    // 2. Autenticar via browser
    await this._launchBrowser();
    const token = await this._authenticate();

    // 3. Salvar token no .env
    this._saveTokenToEnv(token);

    this._startAutoRefresh();
    this._isInitialized = true;

    return token;
  }

  getToken() {
    return this._token;
  }

  isAuthenticated() {
    return this._token !== null;
  }

  async shutdown() {
    this._stopAutoRefresh();
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
    }
    this._isInitialized = false;
    this._logger.info('Serviço encerrado');
  }

  async reAuthenticate() {
    this._logger.warn('Re-autenticação forçada (token inválido ou 401)');
    this._token = null;
    this._tokenExpiry = null;

    if (!this._browser) {
      await this._launchBrowser();
    }

    const token = await this._authenticate();
    this._saveTokenToEnv(token);
    return token;
  }

  // ═══════ privados ═══════

  async _launchBrowser() {
    const tempDir = path.join(os.tmpdir(), 'northradar-edge-profile');
    const originalUserData = path.join(
      os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data',
    );

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const defaultPath = path.join(tempDir, 'Default');
    if (!fs.existsSync(defaultPath)) fs.mkdirSync(defaultPath, { recursive: true });

    for (const file of ['Cookies', 'Login Data', 'Web Data']) {
      try {
        const src = path.join(originalUserData, 'Default', file);
        const dest = path.join(defaultPath, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      } catch (_) { /* arquivo em uso */ }
    }

    this._logger.info('Iniciando browser...');
    this._logger.info(`  headless=${config.browser.headless}, edge=${config.browser.edgePath}`);

    this._browser = await puppeteer.launch({
      headless: config.browser.headless,
      executablePath: config.browser.edgePath,
      userDataDir: tempDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--profile-directory=Default',
        '--disable-features=TranslateUI',
        '--disable-extensions',
      ],
      defaultViewport: null,
      protocolTimeout: 120000,
    });

    this._browser.on('disconnected', () => {
      this._logger.warn('Browser desconectou');
    });
  }

  async _authenticate() {
    this._logger.info('Autenticando com Operview...');

    let page = null;
    try {
      page = await this._browser.newPage();
    } catch (err) {
      throw new Error(`Não foi possível abrir nova aba: ${err.message}`);
    }

    let capturedToken = null;

    page.on('response', async (response) => {
      try {
        if (
          response.url().includes('/autenticacao/autenticar') &&
          response.request().method() === 'POST'
        ) {
          const data = await response.json();
          if (data && data.token) {
            capturedToken = data.token;
            this._logger.info('Token interceptado via response listener');
          }
        }
      } catch (_) { /* resposta não-JSON ou já consumida */ }
    });

    let browserDisconnected = false;
    const onDisconnect = () => { browserDisconnected = true; };
    this._browser.on('disconnected', onDisconnect);

    try {
      this._logger.info('Navegando para operview-ce.enel.com...');
      await page.goto('https://operview-ce.enel.com', {
        waitUntil: 'networkidle0',
        timeout: 90000,
      });
      this._logger.info('Página carregada — aguardando token...');

      let attempts = 0;
      const maxAttempts = 60;
      while (!capturedToken && attempts < maxAttempts && !browserDisconnected) {
        await new Promise((r) => setTimeout(r, 1000));
        attempts++;
        if (attempts % 10 === 0) {
          this._logger.info(`Aguardando token... (${attempts}s)`);
        }
      }

      if (!capturedToken && !browserDisconnected) {
        this._logger.warn('Token não capturado — limpando dados do browser e recarregando...');
        await this._clearBrowserDataAndReload(page);

        attempts = 0;
        while (!capturedToken && attempts < maxAttempts && !browserDisconnected) {
          await new Promise((r) => setTimeout(r, 1000));
          attempts++;
          if (attempts % 10 === 0) {
            this._logger.info(`Aguardando token após reload... (${attempts}s)`);
          }
        }
      }

      await this._safeClosePage(page);

      if (browserDisconnected) {
        throw new Error('Browser foi desconectado durante a autenticação');
      }

      if (capturedToken) {
        this._token = capturedToken;
        this._tokenExpiry = this._getTokenExpiry(capturedToken);
        this._logger.info('✅ Token obtido com sucesso');
        this._saveTokenToEnv(capturedToken);
        return capturedToken;
      }

      throw new Error('Não foi possível capturar o token após tentativa com reload');
    } catch (error) {
      await this._safeClosePage(page);
      throw error;
    } finally {
      this._browser?.off('disconnected', onDisconnect);
    }
  }

  async _clearBrowserDataAndReload(page) {
    try {
      const client = await page.createCDPSession();

      await client.send('Network.clearBrowserCookies');
      this._logger.info('  Cookies limpos');

      await client.send('Network.clearBrowserCache');
      this._logger.info('  Cache limpo');

      await page.evaluate(() => {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
      });
      this._logger.info('  Storage limpo');

      await client.detach();

      this._logger.info('  Recarregando página...');
      await page.reload({ waitUntil: 'networkidle0', timeout: 90000 });
      this._logger.info('  Página recarregada');
    } catch (err) {
      this._logger.error(`Erro ao limpar dados do browser: ${err.message}`);
    }
  }

  async _safeClosePage(page) {
    try {
      if (page && !page.isClosed()) await page.close();
    } catch (_) { /* já fechada */ }
  }

  _startAutoRefresh() {
    const intervalMs = config.refreshIntervalMs;
    const intervalMin = Math.round(intervalMs / 60000);
    this._logger.info(`Auto-refresh configurado (${intervalMin} min)`);

    this._refreshInterval = setInterval(async () => {
      this._logger.info(`Renovando token... (${new Date().toLocaleTimeString()})`);
      try {
        await this._authenticate();
      } catch (error) {
        this._logger.error(`Erro ao renovar token: ${error.message}`);
      }
    }, intervalMs);
  }

  _stopAutoRefresh() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }

  // ═══════ Token persistence ═══════

  _isTokenValid(token) {
    try {
      const payload = this._decodeJwt(token);
      if (!payload || !payload.exp) return false;
      return (payload.exp * 1000) > (Date.now() + 5 * 60 * 1000);
    } catch (_) {
      return false;
    }
  }

  _getTokenExpiry(token) {
    try {
      const payload = this._decodeJwt(token);
      if (payload && payload.exp) return payload.exp * 1000;
    } catch (_) {}
    return Date.now() + 2 * 60 * 60 * 1000;
  }

  _decodeJwt(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
      return JSON.parse(payload);
    } catch (_) {
      return null;
    }
  }

  _saveTokenToEnv(token) {
    try {
      const envPath = config.envFilePath;
      let content = fs.readFileSync(envPath, 'utf8');

      if (content.match(/^TOKEN_ACCESS=.*/m)) {
        content = content.replace(/^TOKEN_ACCESS=.*/m, `TOKEN_ACCESS=${token}`);
      } else {
        content += `\nTOKEN_ACCESS=${token}\n`;
      }

      fs.writeFileSync(envPath, content, 'utf8');
      process.env.TOKEN_ACCESS = token;

      this._logger.info('💾 Token salvo no .env');
    } catch (err) {
      this._logger.warn(`Não foi possível salvar token no .env: ${err.message}`);
    }
  }
}

module.exports = PuppeteerAuthProvider;
