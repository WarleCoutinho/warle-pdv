const messages:Record<string,string>={
 UNAUTHORIZED:'Entre novamente com seu operador e senha.',
 AUTHENTICATION_FAILED:'Operador, senha ou código de autorização incorreto.',
 FORBIDDEN:'Seu operador não tem permissão para esta operação.',
 REAUTHENTICATION_REQUIRED:'Confirme novamente sua senha antes de continuar.',
 RATE_LIMITED:'Muitas tentativas incorretas. Aguarde 15 minutos antes de tentar novamente.',
 INSTALLATION_BLOCKED:'Esta instalação ainda não está preparada para operações comerciais.',
 CASH_UNAVAILABLE:'Confira o operador e o caixa aberto de hoje. Feche as pendências antes de continuar.',
 INSUFFICIENT_FUNDS:'O saldo disponível não é suficiente para esta operação.',
 SALE_INVALID:'Confira os produtos, quantidades e pagamentos da venda.',
 INVALID_REQUEST:'Confira os dados informados antes de continuar.',
 ALREADY_RESOLVED:'Esta operação já foi resolvida ou ultrapassa o valor ou quantidade permitido.',
 CREDIT_UNAUTHORIZED:'Informe novamente o código do crédito antes de concluir a venda.',
 RECOVERY_BLOCKED:'Há uma operação que precisa de recuperação. Preserve os dados e procure suporte.',
 STALE_RECONCILIATION:'O caixa mudou. Confira os valores novamente antes de fechar.',
 REQUEST_CONFLICT:'O identificador desta operação já está associado a outros dados.',
 REQUEST_INTERRUPTED:'A operação foi interrompida e precisa de conferência antes de continuar.',
 DATABASE_BUSY:'O banco está ocupado. Tente novamente para continuar a mesma operação.',
 UNSUPPORTED_OPERATION:'Esta função estará disponível após a preparação da instalação desktop.',
 PRINT_FAILED:'O crédito foi registrado, mas o comprovante não foi impresso. Tente novamente para reimprimir.',
};
export class DesktopPersistenceError extends Error {
 constructor(readonly code:string,readonly requestId?:string){super(messages[code]??'Não foi possível receber a confirmação. A operação pode já ter sido registrada. Tente novamente para recuperar o mesmo resultado.');this.name='DesktopPersistenceError';}
}
export function desktopFailure(error:unknown,requestId?:string){if(error instanceof DesktopPersistenceError)return error;const code=error instanceof Error&&/^[A-Z_]{1,64}$/.test(error.message)?error.message:'COMMUNICATION_FAILED';return new DesktopPersistenceError(code,requestId);}
