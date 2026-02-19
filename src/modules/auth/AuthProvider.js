/**
 * AuthProvider — Interface
 *
 * Contrato que qualquer provedor de autenticação deve cumprir.
 * Os demais módulos dependem SOMENTE desta abstração.
 */
class AuthProvider {
  /** Inicializa o provedor e retorna o primeiro token */
  async initialize() {
    throw new Error('AuthProvider.initialize() não implementado');
  }

  /** Retorna o token JWT atual */
  getToken() {
    throw new Error('AuthProvider.getToken() não implementado');
  }

  /** Verifica se está autenticado */
  isAuthenticated() {
    throw new Error('AuthProvider.isAuthenticated() não implementado');
  }

  /** Força re-autenticação (ex.: após 401/403) */
  async reAuthenticate() {
    throw new Error('AuthProvider.reAuthenticate() não implementado');
  }

  /** Libera recursos (browser, conexões, etc.) */
  async shutdown() {
    throw new Error('AuthProvider.shutdown() não implementado');
  }
}

module.exports = AuthProvider;
