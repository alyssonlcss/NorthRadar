/**
 * Domain Interface — IAuthProvider
 *
 * Contrato que qualquer provedor de autenticação deve cumprir.
 * A camada de Application depende SOMENTE desta interface.
 */
class IAuthProvider {
  /** Inicializa o provedor e retorna o primeiro token */
  async initialize() {
    throw new Error('IAuthProvider.initialize() não implementado');
  }

  /** Retorna o token JWT atual */
  getToken() {
    throw new Error('IAuthProvider.getToken() não implementado');
  }

  /** Verifica se está autenticado */
  isAuthenticated() {
    throw new Error('IAuthProvider.isAuthenticated() não implementado');
  }

  /** Encerra o provedor */
  async shutdown() {
    throw new Error('IAuthProvider.shutdown() não implementado');
  }
}

module.exports = IAuthProvider;
