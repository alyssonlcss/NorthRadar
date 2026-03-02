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
   * Inicializa o browser e realiza o login no Spotfire.
   * Idempotente: chamadas subsequentes são no-op.
   */
  async initialize() {
    if (this._isInitialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      this._logger.info('Iniciando browser...');
      await this._launchBrowser();

      this._logger.info('Realizando login no Spotfire...');
      await this._login();

      this._logger.info('Navegando para o relatório de Deslocamentos...');
      await this._navigateToDeslocamentos();

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

  async _login() {
    await this._page.goto(config.spotfire.url, { waitUntil: 'networkidle2', timeout: config.spotfire.timeout });

    // Aguardar o formulário de login aparecer (ou confirmar que já está logado)
    this._logger.info('Aguardando página de login carregar...');
    const hasLoginForm = await this._page
      .waitForFunction(
        () => !!document.querySelector("input[type='password']"),
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!hasLoginForm) {
      this._logger.info('Sessão já autenticada');
      return;
    }

    this._logger.info('Formulário de login detectado — preenchendo credenciais...');

    // Aguardar campo usuário estar visível e interagível
    await this._page.waitForSelector("input[type='text']", { visible: true, timeout: config.spotfire.timeout });

    // Usuário
    await puppeteer.Locator.race(SELECTORS.auth.username.map((s) => this._page.locator(s)))
      .fill(config.spotfire.credentials.username);

    // Senha
    await puppeteer.Locator.race(SELECTORS.auth.password.map((s) => this._page.locator(s)))
      .fill(config.spotfire.credentials.password);

    // Checkbox "Lembrar-me" (opcional)
    await this._page
      .click(SELECTORS.auth.rememberMe, { timeout: 3000 })
      .catch(() => this._logger.warn('"Lembrar-me" não encontrado'));

    // Submeter — usar waitForFunction em vez de waitForNavigation
    // pois o Spotfire é SPA com hash-routing (não dispara evento de navegação confiável)
    await puppeteer.Locator.race(SELECTORS.auth.loginButton.map((s) => this._page.locator(s))).click();

    // Aguardar o formulário de login desaparecer (indica login bem-sucedido)
    await this._page
      .waitForFunction(
        () => !document.querySelector("input[type='password']"),
        { timeout: config.spotfire.timeout },
      )
      .catch(async () => {
        // Fallback: verificar se URL mudou
        const url = this._page.url();
        if (url.includes('login')) {
          throw new Error('Login no Spotfire falhou — formulário ainda visível após timeout');
        }
        this._logger.warn('Timeout aguardando formulário desaparecer, mas URL parece pós-login');
      });

    this._logger.info('Login realizado');
  }

  async _navigateToDeslocamentos() {
    this._logger.info('Aguardando painel inicial do Spotfire...');
    await this.waitForIdle();

    const TITLE = 'Produtividade UO TR - CE';
    this._logger.info(`Procurando item "${TITLE}" nos recentes...`);

    // Aguarda até o texto aparecer na DOM (classe é dinâmica, busca por conteúdo)
    await this._page
      .waitForFunction(
        (t) => !!Array.from(document.querySelectorAll('div'))
          .find((d) => d.childElementCount === 0 && d.textContent.trim() === t),
        { timeout: config.spotfire.timeout },
        TITLE,
      )
      .catch(() => {
        this._logger.warn(`"${TITLE}" não encontrado no painel de recentes — continuando`);
      });

    // Encontrar e clicar no elemento clicável pai
    const clicked = await this._page.evaluate((t) => {
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => d.childElementCount === 0 && d.textContent.trim() === t);
      if (!el) return false;
      // Sobe até encontrar container clicável do item MRU
      const clickable = el.closest('[class*="sfx_info"], [class*="sfx_mru"], [class*="mru"]')
        || el.parentElement?.parentElement
        || el.parentElement;
      if (clickable) { clickable.click(); return true; }
      return false;
    }, TITLE);

    if (!clicked) {
      this._logger.warn('Não foi possível clicar no item — continuando na página atual');
      return;
    }

    this._logger.info('Item clicado — aguardando relatório carregar...');
    // Aguardar navegação SPA + Spotfire renderizar
    await new Promise((r) => setTimeout(r, 3000));
    await this.waitForIdle();
    this._logger.info('Relatório de Deslocamentos aberto');
  }

  _stopBusyWatcher() {
    // placeholder — extensível para cenários com watchers periódicos
  }
}

module.exports = SpotfireProvider;
