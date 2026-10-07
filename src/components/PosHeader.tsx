type PosHeaderProps = {
  onOpenHistory: () => void;
};

export function PosHeader({ onOpenHistory }: PosHeaderProps) {
  return (
    <div className="pos-top">
      <div className="pos-brand">
        <span className="logo" aria-hidden="true">✳</span>
        raiz
        <span className="local-status">• &nbsp;<b>Operação local</b> · pronto para vender</span>
      </div>
      <button className="history-shortcut" onClick={onOpenHistory} type="button">Histórico de vendas</button>
    </div>
  );
}
