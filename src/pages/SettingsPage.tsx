import { useState, type FormEvent } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import type { AppPage } from '../types/navigation';
import type { StoreSettings } from '../types/settings';

type SettingsPageProps = {
  settings: StoreSettings;
  onNavigate: (page: AppPage) => void;
  onSaveSettings: (settings: StoreSettings) => StoreSettings;
  onClearLocalData: () => StoreSettings;
};

export function SettingsPage({ settings, onNavigate, onSaveSettings, onClearLocalData }: SettingsPageProps) {
  const [draft, setDraft] = useState<StoreSettings>({ ...settings });
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');

  function update<K extends keyof StoreSettings>(field: K, value: StoreSettings[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFeedback('');
    setError('');
    setNameError('');
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.storeName.trim()) {
      setFeedback('');
      setNameError('Informe o nome do estabelecimento.');
      return;
    }
    try {
      const saved = onSaveSettings(draft);
      setDraft(saved);
      setNameError('');
      setError('');
      setFeedback('Configurações salvas.');
    } catch (saveError) {
      setFeedback('');
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as configurações.');
    }
  }

  function clearData() {
    if (confirmationText.trim() !== 'APAGAR') return;
    try {
      const defaults = onClearLocalData();
      setDraft(defaults);
      setError('');
      setFeedback('Dados locais apagados. Produtos iniciais e configurações padrão restaurados.');
      setConfirmationText('');
      setShowClearModal(false);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Não foi possível limpar os dados locais.');
      setShowClearModal(false);
    }
  }

  function closeClearModal() {
    setConfirmationText('');
    setShowClearModal(false);
  }

  return (
    <main className="content settings-content">
      <AppPageTopBar activePage="settings" onNavigate={onNavigate} />
      <div className="title-row settings-title-row">
        <div><h1>Configurações</h1><div className="sub">Personalize os dados do estabelecimento e do comprovante.</div></div>
      </div>

      {feedback && <div className="settings-feedback" role="status">✓ {feedback}</div>}
      {error && <div className="settings-error" role="alert">{error}</div>}

      <form className="settings-form" onSubmit={save}>
        <section aria-labelledby="settings-store-title" className="settings-card">
          <div className="settings-card-heading"><span aria-hidden="true">✳</span><div><h2 id="settings-store-title">Estabelecimento</h2><p>Essas informações identificam sua loja no comprovante.</p></div></div>
          <label className="settings-field">Nome do estabelecimento
            <input aria-describedby={nameError ? 'settings-name-error' : undefined} aria-invalid={Boolean(nameError)} autoComplete="organization" maxLength={80} onChange={(event) => update('storeName', event.target.value)} value={draft.storeName} />
            {nameError && <small className="settings-field-error" id="settings-name-error" role="alert">{nameError}</small>}
          </label>
          <label className="settings-field">Endereço <span>Opcional</span>
            <input autoComplete="street-address" maxLength={160} onChange={(event) => update('address', event.target.value)} placeholder="Rua, número, cidade/UF" value={draft.address} />
          </label>
          <label className="settings-field">Telefone <span>Opcional</span>
            <input autoComplete="tel" maxLength={40} onChange={(event) => update('phone', event.target.value)} placeholder="(00) 00000-0000" type="tel" value={draft.phone} />
          </label>
        </section>

        <section aria-labelledby="settings-receipt-title" className="settings-card">
          <div className="settings-card-heading"><span aria-hidden="true">▤</span><div><h2 id="settings-receipt-title">Comprovante</h2><p>Personalize a mensagem impressa no final do comprovante.</p></div></div>
          <label className="settings-field">Mensagem no rodapé <span>Opcional</span>
            <textarea maxLength={200} onChange={(event) => update('receiptFooter', event.target.value)} placeholder="Obrigado pela preferência!" rows={3} value={draft.receiptFooter} />
          </label>
          <div aria-live="polite" className="settings-character-count">{draft.receiptFooter.length}/200 caracteres</div>
          <div className="settings-receipt-preview"><span>Prévia do rodapé</span>{draft.receiptFooter ? <b>{draft.receiptFooter}</b> : <small>Sem mensagem no rodapé</small>}</div>
        </section>

        <section aria-labelledby="settings-local-title" className="settings-card settings-local-card">
          <div className="settings-card-heading"><span aria-hidden="true">⌂</span><div><h2 id="settings-local-title">Dados locais</h2><p>As vendas, produtos e configurações ficam armazenados neste computador e navegador. Eles não são sincronizados automaticamente com a internet.</p></div></div>
          <div className="settings-danger-zone">
            <div><b>Limpar dados locais</b><span>Apaga vendas, produtos cadastrados, configurações e o rascunho do carrinho.</span></div>
            <button className="settings-danger-button" onClick={() => { setConfirmationText(''); setShowClearModal(true); }} type="button">Limpar dados locais</button>
          </div>
        </section>

        <div className="settings-actions"><button className="btn primary" type="submit">Salvar alterações</button></div>
      </form>

      {showClearModal && (
        <div className="overlay settings-clear-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeClearModal(); }}>
          <section aria-describedby="settings-clear-description" aria-labelledby="settings-clear-title" aria-modal="true" className="modal settings-clear-modal" role="alertdialog">
            <div className="settings-warning-icon" aria-hidden="true">!</div>
            <h2 id="settings-clear-title">Apagar dados locais?</h2>
            <p id="settings-clear-description">Esta ação apagará as vendas armazenadas neste computador, os produtos cadastrados, as configurações e o rascunho do carrinho. As vendas serão perdidas e não poderão ser recuperadas.</p>
            <p className="settings-clear-reset-note">Os produtos iniciais e as configurações padrão serão restaurados.</p>
            <label className="settings-confirm-field">Digite <b>APAGAR</b> para confirmar
              <input autoComplete="off" onChange={(event) => setConfirmationText(event.target.value)} placeholder="APAGAR" value={confirmationText} />
            </label>
            <div className="settings-clear-actions"><button className="btn secondary" onClick={closeClearModal} type="button">Cancelar</button><button className="settings-confirm-delete" disabled={confirmationText.trim() !== 'APAGAR'} onClick={clearData} type="button">Apagar dados</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

