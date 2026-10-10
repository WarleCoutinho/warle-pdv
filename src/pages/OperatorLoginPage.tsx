import { usePdvApplication } from '../application/context';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CashOperator } from '../types/settings';
export function OperatorLoginPage({ onLogin }: { onLogin: (operator: CashOperator) => void | Promise<void> }) {
  const application = usePdvApplication();
  const submitting = useRef(false);
  const [hasDefaultPassword, setHasDefaultPassword] = useState(false);
  useEffect(() => { let active = true; void application.operators.hasDefaultPassword().then((value) => { if (active) setHasDefaultPassword(value); }).catch(() => {}); return () => { active = false; }; }, [application]);
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError(''); try { const operator = await application.operators.login(username, password); setPassword(''); await onLogin(operator); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível entrar.'); } finally { submitting.current = false; setBusy(false); } }
  return <main className="operator-login"><form onSubmit={submit}><h1>Entrar no Raiz PDV</h1><p>Informe seu operador e senha para iniciar.</p><label>Operador<input autoFocus autoComplete="username" required maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Senha<input autoComplete="current-password" required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="cash-error" role="alert">{error}</p>}<button className="btn primary" disabled={busy} type="submit">{busy ? 'Entrando…' : 'Entrar'}</button>{hasDefaultPassword && <small>Primeiro acesso: Admin / 123456. O administrador pode alterar a senha em Configurações.</small>}</form></main>;
}
