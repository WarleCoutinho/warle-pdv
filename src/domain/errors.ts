export class SaleCreditFinalizationPendingError extends Error {
  constructor(public readonly saleId: string) {
    super('A venda foi salva, mas a baixa do crédito está pendente de recuperação. Não repita a venda; atualize o sistema. A venda e a reserva foram preservadas.');
    this.name = 'SaleCreditFinalizationPendingError';
  }
}
