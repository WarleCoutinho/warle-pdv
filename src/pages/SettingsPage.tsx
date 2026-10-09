import { createPasswordDigest } from '../services/operatorAccess';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AppPageTopBar } from '../components/AppPageTopBar';
import type { AppPage } from '../types/navigation';
import type { StoreSettings } from '../types/settings';
import { useModalFocus } from '../hooks/useModalFocus';
import { createBackupJson, getRestoreSafetyCopy, parseBackupJson, restoreBackup, type BackupDocument } from '../services/backupStorage';

type SettingsPageProps = {
  settings: StoreSettings;
  onNavigate: (page: AppPage) => void;
  onSaveSettings: (settings: StoreSettings) => StoreSettings;
  onClearLocalData: () => StoreSettings;
};

export function SettingsPage({ settings, onNavigate, onSaveSettings, onClearLocalData }: SettingsPageProps) {
  const [draft, setDraft] = useState<StoreSettings>({ ...settings });
  const [operatorName, setOperatorName] = useState('');
  const [operatorUsername, setOperatorUsername] = useState('');
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [restoreCandidate, setRestoreCandidate] = useState<{ backup: BackupDocument; summary: ReturnType<typeof parseBackupJson>['summary'] } | null>(null);
  const [backupError, setBackupError] = useState('');
  const [safetyCopy, setSafetyCopy] = useState<string | null>(() => { try { return getRestoreSafetyCopy(); } catch { return null; } });
  const clearDialogRef = useModalFocus(showClearModal ? closeClearModal : undefined, { active: showClearModal });
  const restoreDialogRef = useModalFocus(restoreCandidate ? () => setRestoreCandidate(null) : undefined, { active: Boolean(restoreCandidate) });

  function update<K extends keyof StoreSettings>(field: K, value: StoreSettings[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFeedback('');
    setError('');
    setNameError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.storeName.trim()) {
      setFeedback('');
      setNameError('Informe o nome do estabelecimento.');
      return;
    }
    if (saving) return; setSaving(true);
    try {
      const operators = await Promise.all((draft.operators ?? []).map(async (operator) => ({ ...operator, ...(passwords[operator.id] ? { passwordDigest: await createPasswordDigest(passwords[operator.id]) } : {}) })));
      if (operators.some((operator) => operator.active && !operator.passwordDigest)) throw new Error('Defina uma senha para cada operador ativo.');
      const saved = onSaveSettings({ ...draft, operators });
      setPasswords({});
      setDraft(saved);
      setNameError('');
      setError('');
      setFeedback('Configurações salvas.');
    } catch (saveError) {
      setFeedback('');
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as configurações.');
    } finally { setSaving(false); }
  }

  async function readBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupError('');
    if (file.size > 10 * 1024 * 1024) { setBackupError('O arquivo excede o limite seguro de 10 MB.'); return; }
    try {
      const parsed = parseBackupJson(await file.text());
      setRestoreCandidate(parsed);
    } catch (backupFailure) {
      setRestoreCandidate(null);
      setBackupError(backupFailure instanceof Error ? backupFailure.message : 'Não foi possível validar este arquivo.');
    }
  }

  async function confirmRestore() {
    if (!restoreCandidate) return;
    try {
      await restoreBackup(restoreCandidate.backup);
      window.location.reload();
    } catch (restoreFailure) {
      setBackupError(restoreFailure instanceof Error ? restoreFailure.message : 'Não foi possível restaurar o backup.');
      setRestoreCandidate(null);
      try { setSafetyCopy(getRestoreSafetyCopy()); } catch { setSafetyCopy(null); }
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

        <section className="settings-card" aria-labelledby="settings-operators-title"><h2 id="settings-operators-title">Operadores e senhas</h2><p>Somente o administrador pode cadastrar operadores. Senhas precisam ter ao menos 6 caracteres.</p><label className="settings-field">Nome do operador<input maxLength={80} value={operatorName} onChange={(event) => setOperatorName(event.target.value)} /></label><label className="settings-field">Usuário do operador<input maxLength={80} value={operatorUsername} onChange={(event) => setOperatorUsername(event.target.value)} /></label><button className="btn secondary" type="button" disabled={!operatorName.trim() || !operatorUsername.trim() || saving} onClick={() => { update('operators', [...(draft.operators ?? []), { id: crypto.randomUUID(), name: operatorName.trim(), username: operatorUsername.trim(), role: 'operator', active: true }]); setOperatorName(''); setOperatorUsername(''); }}>Adicionar operador</button>{(draft.operators ?? []).map((operator) => <div className="operator-account" key={operator.id}><label className="settings-field">Nome<input maxLength={80} value={operator.name} onChange={(event) => update('operators', draft.operators!.map((item) => item.id === operator.id ? { ...item, name: event.target.value } : item))} /></label><label className="settings-field">Usuário<input maxLength={80} value={operator.username ?? operator.name} onChange={(event) => update('operators', draft.operators!.map((item) => item.id === operator.id ? { ...item, username: event.target.value } : item))} /></label><label className="settings-field">{operator.passwordDigest ? 'Nova senha (deixe vazio para manter)' : 'Definir senha'}<input aria-label={'Senha de ' + (operator.username ?? operator.name)} type="password" autoComplete="new-password" maxLength={128} value={passwords[operator.id] ?? ''} onChange={(event) => setPasswords({ ...passwords, [operator.id]: event.target.value })} /></label><span>{operator.role === 'admin' ? 'Administrador Mestre' : 'Operador'}</span><label><input type="checkbox" checked={operator.active} onChange={(event) => update('operators', draft.operators!.map((item) => item.id === operator.id ? { ...item, active: event.target.checked } : item))} /> Ativo</label></div>)}<small>Salvar alterações confirma os cadastros e senhas. Ao alterar sua própria senha, entre novamente.</small></section>

        <section aria-labelledby="settings-receipt-title" className="settings-card">
          <div className="settings-card-heading"><span aria-hidden="true">▤</span><div><h2 id="settings-receipt-title">Comprovante</h2><p>Personalize a mensagem impressa no final do comprovante.</p></div></div>
          <label className="settings-field">Mensagem no rodapé <span>Opcional</span>
            <textarea maxLength={200} onChange={(event) => update('receiptFooter', event.target.value)} placeholder="Obrigado pela preferência!" rows={3} value={draft.receiptFooter} />
          </label>
          <div aria-live="polite" className="settings-character-count">{draft.receiptFooter.length}/200 caracteres</div>
          <div className="settings-receipt-preview"><span>Prévia do rodapé</span>{draft.receiptFooter ? <b>{draft.receiptFooter}</b> : <small>Sem mensagem no rodapé</small>}</div>
        </section>

        <section aria-labelledby="settings-backup-title" className="settings-card settings-backup-card">
          <div className="settings-card-heading"><span aria-hidden="true">⇧</span><div><h2 id="settings-backup-title">Backup e restauração</h2><p>Exporte seus dados para guardar uma cópia ou restaure um arquivo de backup validado.</p></div></div>
          <div className="settings-backup-actions">
            <button className="btn primary" onClick={() => {
              try { downloadJson(createBackupJson(), `raiz-pdv-backup-${new Date().toISOString().slice(0, 10)}.json`); setBackupError(''); }
              catch (backupFailure) { setBackupError(backupFailure instanceof Error ? backupFailure.message : 'Não foi possível exportar o backup.'); }
            }} type="button">⇩ Exportar backup</button>
            <label className="settings-backup-file">Selecionar backup JSON
              <input accept=".json,application/json" onChange={readBackupFile} type="file" />
            </label>
          </div>
          <p className="settings-backup-includes">Inclui produtos, configurações, vendas e dados completos do caixa. O carrinho em edição fica de fora.</p>
          {safetyCopy && <div className="settings-safety-copy"><span>Cópia de segurança anterior à última restauração disponível neste computador.</span><button className="text-action" onClick={() => downloadJson(safetyCopy, `raiz-pdv-seguranca-anterior-${new Date().toISOString().slice(0, 10)}.json`)} type="button">Baixar cópia</button></div>}
          {backupError && <div className="settings-error" role="alert">{backupError}</div>}
        </section>

        <section aria-labelledby="settings-local-title" className="settings-card settings-local-card">
          <div className="settings-card-heading"><span aria-hidden="true">⌂</span><div><h2 id="settings-local-title">Dados locais</h2><p>As vendas, produtos e configurações ficam armazenados neste computador e navegador. Eles não são sincronizados automaticamente com a internet.</p></div></div>
          <div className="settings-danger-zone">
            <div><b>Limpar dados locais</b><span>Apaga vendas, produtos cadastrados, configurações e o rascunho do carrinho.</span></div>
            <button className="settings-danger-button" onClick={() => { setConfirmationText(''); setShowClearModal(true); }} type="button">Limpar dados locais</button>
          </div>
        </section>

        <div className="settings-actions"><button className="btn primary" disabled={saving} type="submit">{saving ? "Salvando…" : "Salvar alterações"}</button></div>
      </form>

      {showClearModal && (
        <div className="overlay settings-clear-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeClearModal(); }}>
          <section aria-describedby="settings-clear-description" aria-labelledby="settings-clear-title" aria-modal="true" className="modal settings-clear-modal" ref={clearDialogRef} role="alertdialog" tabIndex={-1}>
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

      {restoreCandidate && <div className="overlay settings-restore-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setRestoreCandidate(null); }}>
        <section aria-describedby="settings-restore-description" aria-labelledby="settings-restore-title" aria-modal="true" className="modal settings-restore-modal" ref={restoreDialogRef} role="alertdialog" tabIndex={-1}>
          <div className="settings-warning-icon" aria-hidden="true">⇧</div>
          <h2 id="settings-restore-title">Confirmar restauração?</h2>
          <p id="settings-restore-description">Os dados atuais serão substituídos pelos dados deste arquivo. Uma cópia de segurança local será criada antes da troca, e a aplicação será recarregada.</p>
          <div className="settings-restore-summary">
            <b>Conteúdo do backup</b>
            <span>{restoreCandidate.summary.products} produtos ({restoreCandidate.summary.activeProducts} ativos)</span>
            <span>{restoreCandidate.summary.sales} vendas ({restoreCandidate.summary.cancelledSales} canceladas)</span>
            <span>{restoreCandidate.summary.cashSessions} sessões de caixa ({restoreCandidate.summary.closedSessions} fechadas)</span>
            <span>{restoreCandidate.summary.cashMovements} suprimentos/sangrias</span>
            <small>Exportado em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(restoreCandidate.summary.exportedAt))}</small>
          </div>
          {backupError && <div className="settings-error" role="alert">{backupError}</div>}
          <div className="settings-clear-actions"><button className="btn secondary" onClick={() => setRestoreCandidate(null)} type="button">Cancelar</button><button className="settings-confirm-restore" onClick={confirmRestore} type="button">Restaurar e recarregar</button></div>
        </section>
      </div>}
    </main>
  );
}



function downloadJson(contents: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
