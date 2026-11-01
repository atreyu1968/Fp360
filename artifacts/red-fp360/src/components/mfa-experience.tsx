import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Clipboard, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import {
  useBeginAdminMfaSetup,
  useConfirmAdminMfa,
  useLogout,
  useVerifyAdminMfa,
} from '@workspace/api-client-react';
import type { AuthIdentity, AuthMfaSetupResult } from '@workspace/api-client-react';
import './mfa-experience.css';

export function AdminMfaExperience({
  identity,
  onAuthenticated,
}: {
  identity: AuthIdentity;
  onAuthenticated: (identity: AuthIdentity) => void;
}) {
  return identity.mfaSetupRequired
    ? <MfaSetup identity={identity} onAuthenticated={onAuthenticated} />
    : <MfaVerify identity={identity} onAuthenticated={onAuthenticated} />;
}

function MfaSetup({
  identity,
  onAuthenticated,
}: {
  identity: AuthIdentity;
  onAuthenticated: (identity: AuthIdentity) => void;
}) {
  const begin = useBeginAdminMfaSetup();
  const confirm = useConfirmAdminMfa();
  const logout = useLogout();
  const [setup, setSetup] = useState<AuthMfaSetupResult | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [confirmedIdentity, setConfirmedIdentity] = useState<AuthIdentity | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    confirm.mutate({ data: { code: code.trim() } }, {
      onSuccess: result => {
        setRecoveryCodes(result.recoveryCodes);
        setConfirmedIdentity(result.identity);
      },
      onError: () => setError('El código no coincide o ha caducado. Comprueba la hora del dispositivo e inténtalo de nuevo.'),
    });
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
    } catch {
      setError('No se pudo copiar. Selecciona los códigos y guárdalos manualmente.');
    }
  };

  const signOut = () => logout.mutate(undefined, {
    onSuccess: () => window.location.assign(`${import.meta.env.BASE_URL}sign-in`),
    onError: () => setError('No se pudo cerrar la sesión. Inténtalo de nuevo.'),
  });

  return <main className="mfa-page">
    <section className="mfa-card" aria-labelledby="mfa-title">
      <div className="mfa-mark"><ShieldCheck size={22} /></div>
      <p className="mfa-eyebrow">PROTECCIÓN DE CUENTA ADMINISTRADORA</p>
      {recoveryCodes ? <>
        <h1 id="mfa-title">Guarda tus códigos de recuperación</h1>
        <p className="mfa-copy">Cada código sirve una sola vez si pierdes acceso a tu aplicación de autenticación. No volverán a mostrarse.</p>
        <ol className="mfa-recovery-list">{recoveryCodes.map(item => <li key={item}><code>{item}</code></li>)}</ol>
        <button type="button" className="mfa-secondary" onClick={() => void copyRecoveryCodes()}><Clipboard size={15} />{copied ? 'Códigos copiados' : 'Copiar códigos'}</button>
        <label className="mfa-saved"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />He guardado los códigos en un lugar seguro</label>
        {error && <p className="mfa-error" role="alert">{error}</p>}
        <button className="mfa-primary" disabled={!saved || !confirmedIdentity} onClick={() => confirmedIdentity && onAuthenticated(confirmedIdentity)}>Continuar al sistema <ArrowRight size={16} /></button>
      </> : <>
        <h1 id="mfa-title">Activa la verificación en dos pasos</h1>
        <p className="mfa-copy">Las cuentas administradoras usan códigos temporales de una aplicación autenticadora. La clave se cifra en el servidor y no se contacta con servicios externos.</p>
        {!setup ? <button className="mfa-primary" disabled={begin.isPending} onClick={() => {
          setError('');
          begin.mutate(undefined, {
            onSuccess: result => setSetup(result),
            onError: () => setError('No se pudo iniciar la configuración. Vuelve a intentarlo.'),
          });
        }}>{begin.isPending ? 'Preparando…' : 'Generar clave de configuración'} <ArrowRight size={16} /></button> : <>
          <div className="mfa-step"><span>1</span><div><b>Registra esta clave en tu aplicación</b><p>También puedes abrirla desde el dispositivo que tiene la aplicación instalada.</p></div></div>
          <a className="mfa-open-app" href={setup.otpauthUrl}><KeyRound size={15} /> Abrir aplicación autenticadora</a>
          <label className="mfa-secret-label">Clave manual<input readOnly value={setup.secret} onFocus={event => event.currentTarget.select()} aria-label="Clave manual para autenticador" /></label>
          <small className="mfa-expiry">Válida hasta {new Date(setup.expiresAt).toLocaleTimeString()}</small>
          <form className="mfa-form" onSubmit={submitCode}>
            <label>Código de seis cifras<input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="000000" /></label>
            {error && <p className="mfa-error" role="alert">{error}</p>}
            <button className="mfa-primary" disabled={confirm.isPending || code.length !== 6}>{confirm.isPending ? 'Verificando…' : 'Confirmar y crear códigos'} <ArrowRight size={16} /></button>
          </form>
        </>}
        {!setup && error && <p className="mfa-error" role="alert">{error}</p>}
      </>}
      <div className="mfa-footer"><span>{identity.email}</span><button type="button" onClick={signOut} disabled={logout.isPending}>{logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}</button></div>
    </section>
  </main>;
}

function MfaVerify({
  identity,
  onAuthenticated,
}: {
  identity: AuthIdentity;
  onAuthenticated: (identity: AuthIdentity) => void;
}) {
  const verify = useVerifyAdminMfa();
  const logout = useLogout();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    verify.mutate({ data: { code: code.trim() } }, {
      onSuccess: onAuthenticated,
      onError: () => setError('El código no es válido o ya se ha usado. Comprueba la hora del dispositivo o utiliza un código de recuperación.'),
    });
  };
  const signOut = () => logout.mutate(undefined, {
    onSuccess: () => window.location.assign(`${import.meta.env.BASE_URL}sign-in`),
    onError: () => setError('No se pudo cerrar la sesión. Inténtalo de nuevo.'),
  });

  return <main className="mfa-page">
    <section className="mfa-card" aria-labelledby="mfa-title">
      <div className="mfa-mark"><LockKeyhole size={22} /></div>
      <p className="mfa-eyebrow">VERIFICACIÓN DE SEGUNDO FACTOR</p>
      <h1 id="mfa-title">Confirma que eres tú</h1>
      <p className="mfa-copy">Introduce el código de tu aplicación autenticadora o uno de tus códigos de recuperación.</p>
      <form className="mfa-form" onSubmit={submit}>
        <label>Código de verificación<input value={code} onChange={event => setCode(event.target.value.slice(0, 32))} autoComplete="one-time-code" inputMode="text" required minLength={6} maxLength={32} placeholder="Código temporal o de recuperación" /></label>
        {error && <p className="mfa-error" role="alert">{error}</p>}
        <button className="mfa-primary" disabled={verify.isPending}>{verify.isPending ? 'Verificando…' : 'Verificar acceso'} <ArrowRight size={16} /></button>
      </form>
      <div className="mfa-footer"><span>{identity.email}</span><button type="button" onClick={signOut} disabled={logout.isPending}>{logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}</button></div>
    </section>
  </main>;
}
