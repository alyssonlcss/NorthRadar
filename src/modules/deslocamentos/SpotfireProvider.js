/**
 * SpotfireProvider
 *
 * Gerencia a sessão Puppeteer do Spotfire: inicializa o browser,
 * realiza login e expõe a page pronta para navegação.
 *
 * Análogo ao PuppeteerAuthProvider, mas para o Spotfire
 * (scraping direto de UI, sem token JWT).
 */
const puppeteer = require('puppeteer');
const config = require('../../config');
const Logger = require('../../shared/Logger');

// ── Seletores do Spotfire ─────────────────────────────────────────
const SELECTORS = {
  auth: {
    username: [
      '::-p-aria(Username)',
      "input[type='text']",
      '::-p-xpath(/html/body/div/div/div/div/form/input[1])',
    ],
    password: [
      '::-p-aria(Password)',
      "input[type='password']",
      '::-p-xpath(/html/body/div/div/div/div/form/input[2])',
    ],
    rememberMe: 'form span',
    loginButton: [
      '::-p-aria(Log in)',
      'div.ng-binding',
      '::-p-xpath(/html/body/div/div/div/div/form/button/div[1])',
    ],
  },
  dashboard: {
    busyIndicator: '.sf-busy',
  },
};

class SpotfireProvider {
  constructor() {
    this._browser = null;
    this._page = null;
    this._isInitialized = false;
    this._initPromise = null;
    this._logger = Logger.create('SpotfireProvider');
  }

  // ── Pública ───────────────────────────────────────────────────────

  /**
   * Inicializa o browser e navega até o relatório.
   * Se o Spotfire redirecionar para login, autentica e re-navega automaticamente.
   * Idempotente: chamadas subsequentes são no-op.
   */
  async initialize() {
    if (this._isInitialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      this._logger.info('Iniciando browser...');
      await this._launchBrowser();

      this._logger.info('Navegando para o relatório de Deslocamentos...');
      await this._goToReport();

      this._isInitialized = true;
      this._logger.info('SpotfireProvider pronto');
    })();

    try {
      await this._initPromise;
    } catch (err) {
      // Se falhar, permite retry em chamadas futuras.
      this._initPromise = null;
      throw err;
    }

    this._initPromise = null;
  }

  /** Retorna a page Puppeteer para uso externo (ex.: DeslocamentoRepository). */
  getPage() {
    if (!this._isInitialized || !this._page) {
      throw new Error('SpotfireProvider não inicializado. Chame initialize() primeiro.');
    }
    return this._page;
  }

  /** Encerra o browser e reseta o estado. */
  async shutdown() {
    this._stopBusyWatcher();
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
      this._page = null;
    }
    this._isInitialized = false;
    this._initPromise = null;
    this._logger.info('Browser encerrado');
  }

  /**
   * Aguarda o Spotfire terminar de carregar (indicador `.sf-busy` some).
   * @param {number} [timeoutMs]
   */
  async waitForIdle(timeoutMs = config.spotfire.timeout) {
    await this._page
      .waitForFunction(
        () => !document.querySelector('.sf-busy'),
        { timeout: timeoutMs },
      )
      .catch(() => this._logger.warn('Timeout aguardando idle — continuando...'));
  }

  /**
   * Verifica se a sessão do Spotfire expirou (redirecionamento para login)
   * e re-autentica + re-navega se necessário.
   *
   * @returns {Promise<boolean>} true se uma re-autenticação foi realizada
   */
  async ensureSession() {
    const onLoginPage = await this._isOnLoginPage();
    if (!onLoginPage) return false;

    this._logger.warn('Sessão Spotfire expirada — re-autenticando e reabrindo relatório...');
    await this._goToReport();
    this._logger.info('Sessão re-estabelecida');
    return true;
  }

  // ── Privada ───────────────────────────────────────────────────────

  async _launchBrowser() {
    this._browser = await puppeteer.launch({
      headless: config.spotfire.headless,
      executablePath: config.browser.edgePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=TranslateUI',
      ],
      defaultViewport: { width: 1400, height: 900 },
      protocolTimeout: 120000,
    });
    this._page = await this._browser.newPage();
    this._page.setDefaultTimeout(config.spotfire.timeout);
  }

  /**
   * Navega diretamente para o relatório via URL.
   * Detecta redirecionamento para login e autentica automaticamente.
   */
  async _goToReport() {
    const reportUrl = config.spotfire.reportUrl;
    this._logger.info(`Acessando relatório: ${reportUrl}`);

    await this._page.goto(reportUrl, { waitUntil: 'networkidle2', timeout: config.spotfire.timeout });

    if (await this._isOnLoginPage()) {
      this._logger.info('Redirecionado para login — autenticando...');
      await this._doLogin();

      // Re-navega após login bem-sucedido
      this._logger.info('Re-navegando para o relatório após login...');
      await this._page.goto(reportUrl, { waitUntil: 'networkidle2', timeout: config.spotfire.timeout });
    }

    await this.waitForIdle();
    this._logger.info('Relatório de Deslocamentos aberto');
  }

  /**
   * Retorna true se a page atual é a tela de login do Spotfire.
   */
  async _isOnLoginPage() {
    try {
      const url = this._page.url();
      if (url.includes('login')) return true;
      // Verifica também pela presença do formulário (SPA pode não mudar a URL)
      return await this._page.evaluate(
        () => !!document.querySelector("input[type='password']"),
      );
    } catch {
      return false;
    }
  }

  /**
   * Preenche e submete o formulário de login do Spotfire.
   */
  async _doLogin() {
    this._logger.info('Aguardando formulário de login carregar...');
    await this._page.waitForSelector("input[type='password']", { visible: true, timeout: 15000 });
    await this._page.waitForSelector("input[type='text']",     { visible: true, timeout: config.spotfire.timeout });

    this._logger.info('Preenchendo credenciais...');

    await puppeteer.Locator.race(SELECTORS.auth.username.map((s) => this._page.locator(s)))
      .fill(config.spotfire.credentials.username);

    await puppeteer.Locator.race(SELECTORS.auth.password.map((s) => this._page.locator(s)))
      .fill(config.spotfire.credentials.password);

    await this._page
      .click(SELECTORS.auth.rememberMe, { timeout: 3000 })
      .catch(() => this._logger.warn('"Lembrar-me" não encontrado'));

    await puppeteer.Locator.race(SELECTORS.auth.loginButton.map((s) => this._page.locator(s))).click();

    // Aguardar formulário desaparecer = login concluído
    await this._page
      .waitForFunction(
        () => !document.querySelector("input[type='password']"),
        { timeout: config.spotfire.timeout },
      )
      .catch(async () => {
        const url = this._page.url();
        if (url.includes('login')) {
          throw new Error('Login no Spotfire falhou — formulário ainda visível após timeout');
        }
        this._logger.warn('Timeout aguardando formulário desaparecer, mas URL parece pós-login');
      });

    this._logger.info('Login realizado');
  }

  _stopBusyWatcher() {
    // placeholder — extensível para cenários com watchers periódicos
  }
}

module.exports = SpotfireProvider;
