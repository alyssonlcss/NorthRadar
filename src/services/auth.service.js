/**
 * NorthRadar - Auth Service
 * 
 * Responsável por autenticação com Operview via Edge browser.
 * Mantém token JWT atualizado automaticamente.
 * 
 * Uso:
 *   const authService = require('./services/auth.service');
 *   await authService.initialize();
 *   const token = await authService.getToken();
 */

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const config = require('../config');

class AuthService {
  constructor() {
    this._token = null;
    this._tokenExpiry = null;
    this._browser = null;
    this._refreshInterval = null;
    this._isInitialized = false;
  }

  /**
   * Inicializa o serviço de autenticação
   * Abre o browser Edge e obtém o primeiro token
   */
  async initialize() {
    if (this._isInitialized) {
      return this._token;
    }

    await this._launchBrowser();
    const token = await this._authenticate();
    this._startAutoRefresh();
    this._isInitialized = true;
    
    return token;
  }

  /**
   * Retorna o token atual
   * @returns {string|null} JWT token do Operview
   */
  getToken() {
    return this._token;
  }

  /**
   * Verifica se está autenticado
   * @returns {boolean}
   */
  isAuthenticated() {
    return this._token !== null;
  }

  /**
   * Para o serviço e fecha o browser
   */
  async shutdown() {
    this._stopAutoRefresh();
    
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
    }
    
    this._isInitialized = false;
    console.log('[AuthService] Serviço encerrado');
  }

  // ===== Métodos Privados =====

  async _launchBrowser() {
    const tempDir = path.join(os.tmpdir(), 'northradar-edge-profile');
    const originalUserData = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
    
    // Criar pasta temporária
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Copiar cookies do Edge para manter sessão
    const defaultPath = path.join(tempDir, 'Default');
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true });
    }
    
    const filesToCopy = ['Cookies', 'Login Data', 'Web Data'];
    for (const file of filesToCopy) {
      try {
        const src = path.join(originalUserData, 'Default', file);
        const dest = path.join(defaultPath, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      } catch (e) {
        // Arquivo pode estar em uso
      }
    }

    console.log('[AuthService] Iniciando browser...');
    
    this._browser = await puppeteer.launch({
      headless: config.browser.headless,
      executablePath: config.browser.edgePath,
      userDataDir: tempDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--profile-directory=Default',
      ],
      defaultViewport: null
    });
  }

  async _authenticate() {
    console.log('[AuthService] Autenticando com Operview...');
    
    const page = await this._browser.newPage();
    let capturedToken = null;

    // Interceptar resposta de autenticação
    page.on('response', async (response) => {
      if (response.url().includes('/autenticacao/autenticar') && response.request().method() === 'POST') {
        try {
          const data = await response.json();
          capturedToken = data.token;
        } catch (e) {}
      }
    });

    try {
      await page.goto('https://operview-ce.enel.com', { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });

      // Aguardar token ser capturado
      let attempts = 0;
      while (!capturedToken && attempts < 30) {
        await this._sleep(1000);
        attempts++;
      }

      await page.close();

      if (capturedToken) {
        this._token = capturedToken;
        this._tokenExpiry = Date.now() + (2 * 60 * 60 * 1000); // 2 horas
        console.log('[AuthService] ✅ Token obtido com sucesso');
        return capturedToken;
      } else {
        throw new Error('Não foi possível capturar o token');
      }

    } catch (error) {
      await page.close();
      throw error;
    }
  }

  _startAutoRefresh() {
    const intervalMs = config.refreshIntervalMs;
    const intervalMin = Math.round(intervalMs / 60000);
    
    console.log(`[AuthService] Auto-refresh configurado (${intervalMin} min)`);

    this._refreshInterval = setInterval(async () => {
      console.log(`[AuthService] Renovando token... (${new Date().toLocaleTimeString()})`);
      try {
        await this._authenticate();
      } catch (error) {
        console.error('[AuthService] Erro ao renovar token:', error.message);
      }
    }, intervalMs);
  }

  _stopAutoRefresh() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton - uma única instância compartilhada
const authService = new AuthService();

module.exports = authService;
