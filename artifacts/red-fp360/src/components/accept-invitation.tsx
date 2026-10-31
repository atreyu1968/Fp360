import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, MailCheck, ShieldCheck } from 'lucide-react';
import { useAcceptInvitation, useInspectInvitation } from '@workspace/api-client-react';
import type { AuthIdentity, InvitationPreview } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { accessRoleLabel, dateTime, httpStatus } from './admin-shared';

function inviteError(error: unknown) {
  const s = httpStatus(error);
  if (s === 410 || s === 404) return 'Esta invitación no es válida, ha caducado o ya se ha utilizado. Pide a la administración del centro un enlace nuevo.';
  if (s === 400 || s === 422) return 'Los datos no son válidos. Revisa el nombre y la contraseña (12 a 128 caracteres).';
  if (s === 409) return 'Ya existe una cuenta con este correo. Inicia sesión con ella.';
  if (s === 429) return 'Demasiados intentos. Espera un momento antes de volver a intentarlo.';
  if (s >= 500) return 'El servicio no está disponible ahora. Inténtalo más tarde.';
  return 'No se pudo comprobar la invitación. Comprueba tu conexión e inténtalo de nuevo.';
}

function readFragmentToken() {
  const hash = window.location.hash.replace(/^#/, '');
  const token = new URLSearchParams(hash).get('token') ?? '';
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return token;
}

export function AcceptInvitation({ onAuthenticated }: { onAuthenticated: (identity: AuthIdentity) => void }) {
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) tokenRef.current = readFragmentToken();
  const inspect = useInspectInvitation();
  const accept = useAcceptInvitation();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [fatal, setFatal] = useState('');
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const started = useRef(false);
  const inspectRef = useRef(inspect.mutate);
  inspectRef.current = inspect.mutate;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenRef.current ?? '';
    if (token.length < 32) { setFatal('El enlace no contiene una invitación válida. Abre el enlace completo que te facilitó tu centro.'); return; }
    inspectRef.current({ data: { token } }, { onSuccess: setPreview, onError: (e) => setFatal(inviteError(e)) });
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    accept.mutate({ data: { token: tokenRef.current ?? '', displayName: displayName.trim(), password } }, {
      onSuccess: (identity) => { tokenRef.current = ''; setPassword(''); setConfirm(''); onAuthenticated(identity); },
      onError: (err) => { if (httpStatus(err) === 410) setFatal(inviteError(err)); else setError(inviteError(err)); },
    });
  };

  return <main className="auth-page">
    <section className="auth-visual" aria-label="RED FP360, aprendizaje empresarial simulado">
      <div className="auth-brand"><span className="brand-mark"><span>R</span><i /></span><span className="brand-name"><b>RED FP360</b><small>EMPRESA SIMULADA · FP</small></span></div>
      <div className="auth-art" aria-hidden="true">
        <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" />
        <div className="auth-node auth-node-a" /><div className="auth-node auth-node-b" /><div className="auth-node auth-node-c" /><div className="auth-node auth-node-d" />
        <div className="auth-gridline" /><div className="auth-art-label"><span /> RED EDUCATIVA · CANARIAS</div>
      </div>
      <div className="auth-story"><p className="auth-eyebrow">TE HAN INVITADO</p><h1>Tu centro te espera.<br /><em>Únete a la red.</em></h1><p>Crea tu cuenta para trabajar con tu equipo en la empresa simulada.</p></div>
      <div className="auth-visual-foot"><span>Simulación educativa</span><span>·</span><span>Canarias</span></div>
    </section>
    <section className="auth-main"><div className="auth-card-wrap"><div className="auth-card">
      <div className="auth-card-mark" aria-hidden="true"><MailCheck size={20} /></div>
      <p className="auth-overline">INVITACIÓN</p>
      {fatal ? <>
        <h2>No podemos usar esta invitación</h2>
        <div className="auth-error" role="alert" data-testid="status-invite-error" style={{ marginTop: 18 }}><CircleAlert size={17} /><span>{fatal}</span></div>
        <div className="auth-switch"><Link href="/sign-in" data-testid="link-invite-sign-in">Ir a iniciar sesión</Link></div>
      </> : !preview ? <>
        <h2>Comprobando la invitación</h2>
        <div className="auth-skeleton" role="status" aria-label="Comprobando invitación" style={{ marginTop: 22 }}><span /><span /><span /></div>
      </> : <>
        <h2>Crea tu cuenta</h2>
        <p className="auth-intro">Acceso como <b data-testid="text-invite-role">{accessRoleLabel(preview.role)}</b> para <b data-testid="text-invite-email">{preview.email}</b>. Caduca el {dateTime(preview.expiresAt)}.</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field"><span>Nombre completo</span><input autoComplete="name" required minLength={1} maxLength={100} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Cómo te verá tu equipo" data-testid="input-invite-name" /></label>
          <label className="auth-field"><span>Contraseña</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Al menos 12 caracteres" data-testid="input-invite-password" /></label>
          <label className="auth-field"><span>Repite la contraseña</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-invite-confirm" /></label>
          {error && <div className="auth-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
          <button className="auth-submit" type="submit" disabled={accept.isPending} data-testid="button-accept-invitation">{accept.isPending ? 'Creando cuenta…' : 'Aceptar y entrar'} {!accept.isPending && <ArrowRight size={16} />}</button>
          <div className="auth-trust"><ShieldCheck size={16} /><span>La sesión se mantiene con una cookie segura del servidor. No guardamos credenciales en este dispositivo.</span></div>
        </form>
        <div className="auth-switch"><span>¿Ya tienes cuenta? <Link href="/sign-in">Inicia sesión</Link></span></div>
      </>}
    </div></div></section>
  </main>;
}
