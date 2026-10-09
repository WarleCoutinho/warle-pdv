/** Business dates always use the store timezone, including midnight rollover. */
export function cashBusinessDate(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function cashLabel(session: { id: string; openedAt: string; operatorName?: string }): string {
  return `Caixa ${cashBusinessDate(session.openedAt)} · ${session.operatorName ?? 'Operador não informado (legado)'}`;
}
