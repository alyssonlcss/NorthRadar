/**
 * Infrastructure — PuppeteerAuthProvider
 *
 * Implementação concreta de IAuthProvider usando Puppeteer + Edge.
 * Mantém o token JWT atualizado automaticamente.
 */
const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const config = require('../../config');
const IAuthProvider = require('../../domain/repositories/IAuthProvider');

class PuppeteerAuthProvider extends IAuthProvider {
  constructor() {
    super();
    this._token = null;
    this._tokenExpiry = null;
    this._browser = null;
    this._refreshInterval = null;
    this._isInitialized = false;
  }

  async initialize() {
    if (this._isInitialized) return this._token;

    // 1. Tentar usar token salvo no .env
    const savedToken = config.tokenAccess;
    if (savedToken && this._isTokenValid(savedToken)) {
      this._token = savedToken;
      this._tokenExpiry = this._getTokenExpiry(savedToken);
      console.log('[AuthProvider] ✅ Token carregado do .env (ainda válido)');
      console.log(`[AuthProvider]   Expira em: ${new Date(this._tokenExpiry).toLocaleString()}`);
      this._startAutoRefresh();
      this._isInitialized = true;
      return this._token;
    }

    if (savedToken) {
      console.log('[AuthProvider] ⚠️  Token no .env expirado — autenticando via browser...');
    } else {
      console.log('[AuthProvider] Nenhum token salvo — autenticando via browser...');
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
    console.log('[AuthProvider] Serviço encerrado');
  }

  // ═══════ privados ═══════

  async _launchBrowser() {
    const tempDir = path.join(os.tmpdir(), 'northradar-edge-profile');
    const originalUserData = path.join(
      os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'
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

    console.log('[AuthProvider] Iniciando browser...');
    console.log(`[AuthProvider]   headless=${config.browser.headless}, edge=${config.browser.edgePath}`);

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

    // Se o browser fechar inesperadamente, logar
    this._browser.on('disconnected', () => {
      console.warn('[AuthProvider] ⚠️  Browser desconectou');
    });
  }

  async _authenticate() {
    console.log('[AuthProvider] Autenticando com Operview...');

    let page = null;
    try {
      page = await this._browser.newPage();
    } catch (err) {
      throw new Error(`Não foi possível abrir nova aba: ${err.message}`);
    }

    let capturedToken = null;

    // Interceptar resposta de autenticação
    page.on('response', async (response) => {
      try {
        if (
          response.url().includes('/autenticacao/autenticar') &&
          response.request().method() === 'POST'
        ) {
          const data = await response.json();
          if (data && data.token) {
            capturedToken = data.token;
            console.log('[AuthProvider] Token interceptado via response listener');
          }
        }
      } catch (_) { /* resposta não-JSON ou já consumida */ }
    });

    // Monitorar se o browser desconecta inesperadamente
    let browserDisconnected = false;
    const onDisconnect = () => { browserDisconnected = true; };
    this._browser.on('disconnected', onDisconnect);

    try {
      console.log('[AuthProvider] Navegando para operview-ce.enel.com...');
      await page.goto('https://operview-ce.enel.com', {
        waitUntil: 'networkidle0',
        timeout: 90000,
      });
      console.log('[AuthProvider] Página carregada — aguardando token...');

      // Aguardar até 60 s pelo token
      let attempts = 0;
      const maxAttempts = 60;
      while (!capturedToken && attempts < maxAttempts && !browserDisconnected) {
        await new Promise((r) => setTimeout(r, 1000));
        attempts++;
        if (attempts % 10 === 0) {
          console.log(`[AuthProvider] Aguardando token... (${attempts}s)`);
        }
      }

      // Fechar a aba com segurança
      await this._safeClosePage(page);

      if (browserDisconnected) {
        throw new Error('Browser foi desconectado durante a autenticação');
      }

      if (capturedToken) {
        this._token = capturedToken;
        this._tokenExpiry = this._getTokenExpiry(capturedToken);
        console.log('[AuthProvider] ✅ Token obtido com sucesso');
        this._saveTokenToEnv(capturedToken);
        return capturedToken;
      }

      throw new Error(`Não foi possível capturar o token após ${maxAttempts}s`);
    } catch (error) {
      await this._safeClosePage(page);
      throw error;
    } finally {
      this._browser?.off('disconnected', onDisconnect);
    }
  }

  /** Fecha a página sem lançar erro se já estiver fechada */
  async _safeClosePage(page) {
    try {
      if (page && !page.isClosed()) await page.close();
    } catch (_) { /* já fechada */ }
  }

  _startAutoRefresh() {
    const intervalMs = config.refreshIntervalMs;
    const intervalMin = Math.round(intervalMs / 60000);
    console.log(`[AuthProvider] Auto-refresh configurado (${intervalMin} min)`);

    this._refreshInterval = setInterval(async () => {
      console.log(`[AuthProvider] Renovando token... (${new Date().toLocaleTimeString()})`);
      try {
        await this._authenticate();
      } catch (error) {
        console.error('[AuthProvider] Erro ao renovar token:', error.message);
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

  /**
   * Decodifica o payload JWT e verifica se o token ainda é válido
   * @param {string} token
   * @returns {boolean}
   */
  _isTokenValid(token) {
    try {
      const payload = this._decodeJwt(token);
      if (!payload || !payload.exp) return false;
      // Margem de 5 minutos
      return (payload.exp * 1000) > (Date.now() + 5 * 60 * 1000);
    } catch (_) {
      return false;
    }
  }

  /**
   * Extrai a data de expiração do JWT
   * @param {string} token
   * @returns {number} timestamp ms
   */
  _getTokenExpiry(token) {
    try {
      const payload = this._decodeJwt(token);
      if (payload && payload.exp) return payload.exp * 1000;
    } catch (_) {}
    // fallback: 2 horas a partir de agora
    return Date.now() + 2 * 60 * 60 * 1000;
  }

  /**
   * Decodifica o payload de um JWT (sem validar assinatura)
   * @param {string} token
   * @returns {Object|null}
   */
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

  /**
   * Salva o token no arquivo .env (cria ou atualiza a linha TOKEN_ACCESS=)
   * @param {string} token
   */
  _saveTokenToEnv(token) {
    try {
      const envPath = config.envFilePath;
      let content = fs.readFileSync(envPath, 'utf8');

      if (content.match(/^TOKEN_ACCESS=.*/m)) {
        // Atualizar linha existente
        content = content.replace(/^TOKEN_ACCESS=.*/m, `TOKEN_ACCESS=${token}`);
      } else {
        // Adicionar ao final
        content += `\nTOKEN_ACCESS=${token}\n`;
      }

      fs.writeFileSync(envPath, content, 'utf8');

      // Atualizar também o process.env em memória
      process.env.TOKEN_ACCESS = token;

      console.log('[AuthProvider] 💾 Token salvo no .env');
    } catch (err) {
      console.error('[AuthProvider] ⚠️  Não foi possível salvar token no .env:', err.message);
    }
  }
}

module.exports = PuppeteerAuthProvider;
