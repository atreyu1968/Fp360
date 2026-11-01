import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, MailCheck, ShieldCheck, X } from 'lucide-react';
import {
  getGetCurrentIdentityQueryKey, useAcceptExistingAccountInvitation, useAcceptInvitation,
  useGetCurrentIdentity, useInspectInvitation, useLogin, useLogout,
  useRejectExistingAccountInvitation,
} from '@workspace/api-client-react';
import type { AuthIdentity, InvitationPreview } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { accessRoleLabel, dateTime, httpStatus } from './admin-shared';

type AuthenticatedOptions = { stayOnInvitation?: boolean };
function inviteError(error: unknown) {
  const s = httpStatus(error);
  if (s === 410 || s === 404) return 'Esta invitación no es válida, ha caducado o ya se ha utilizado. Pide a la administración del centro un enlace nuevo.';
  if (s === 400 || s === 422) return 'Los datos no son válidos. Revisa el nombre y la contraseña (12 a 128 caracteres).';
  if (s === 401) return 'Inicia sesión con la cuenta indicada en esta invitación antes de aceptarla.';
  if (s === 403) return 'La sesión activa no corresponde al correo de esta invitación.';
  if (s === 409) return 'Esta cuenta ya tiene acceso a la red o la invitación ya se ha resuelto. No se han cambiado sus accesos.';
  if (s === 429) return 'Demasiados intentos. Espera un momento antes de volver a intentarlo.';
  if (s >= 500) return 'El servicio no está disponible ahora. Inténtalo más tarde.';
  return 'No se pudo comprobar la invitación. Comprueba tu conexión e inténtalo de nuevo.';
}

function readFragmentToken() {
  const hash = window.location.hash.replace(/^#/, '');
  let token = new URLSearchParams(hash).get('token') ?? '';
  try {
    token ||= window.sessionStorage.getItem('redfp360_pending_invitation_token') ?? '';
    if (token) {
      window.sessionStorage.setItem('redfp360_pending_invitation_token', token);
      window.sessionStorage.setItem('redfp360_pending_invitation_return', 'true');
    }
  } catch { /* The URL fragment still provides the one-time token in restricted browsers. */ }
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return token;
}
function clearPendingInvitation() {
  try {
    window.sessionStorage.removeItem('redfp360_pending_invitation_token');
    window.sessionStorage.removeItem('redfp360_pending_invitation_return');
  } catch { /* Cleanup must not block an already completed invitation decision. */ }
}

export function AcceptInvitation({ onAuthenticated }: { onAuthenticated: (identity: AuthIdentity, options?: AuthenticatedOptions) => void }) {
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) {
    try { tokenRef.current = readFragmentToken(); }
    catch { tokenRef.current = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? ''; }
  }
  const queryClient = useQueryClient();
  const identityQuery = useGetCurrentIdentity({ query: { retry: false } });
  const inspect = useInspectInvitation();
  const accept = useAcceptInvitation();
  const acceptExisting = useAcceptExistingAccountInvitation();
  const rejectExisting = useRejectExistingAccountInvitation();
  const login = useLogin();
  const logout = useLogout();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [fatal, setFatal] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<'accepted' | 'rejected' | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const started = useRef(false);
  const inspectRef = useRef(inspect.mutate);
  inspectRef.current = inspect.mutate;

  const token = tokenRef.current ?? '';
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (token.length < 32) {
      clearPendingInvitation();
      setFatal('El enlace no contiene una invitación válida. Abre el enlace completo que te facilitó tu centro.');
      return;
    }
    inspectRef.current({ data: { token } }, { onSuccess: setPreview, onError: (e) => {
      if (httpStatus(e) === 410) { tokenRef.current = ''; clearPendingInvitation(); }
      setFatal(inviteError(e));
    } });
  }, []);

  const identity = identityQuery.data;
  const emailMatches = Boolean(identity && preview && identity.email.trim().toLowerCase() === preview.email.trim().toLowerCase());
  const busy = accept.isPending || acceptExisting.isPending || rejectExisting.isPending || login.isPending || logout.isPending;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    accept.mutate({ data: { token: tokenRef.current ?? '', displayName: displayName.trim(), password } }, {
      onSuccess: (identity) => { tokenRef.current = ''; clearPendingInvitation(); setPassword(''); setConfirm(''); onAuthenticated(identity); },
      onError: (err) => {
        if (httpStatus(err) === 410) { tokenRef.current = ''; clearPendingInvitation(); setFatal(inviteError(err)); }
        else setError(inviteError(err));
      },
    });
  };

  const signIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (!preview) return;
    login.mutate({ data: { email: preview.email, password } }, {
      onSuccess: (signedIn) => {
        setPassword('');
        onAuthenticated(signedIn, { stayOnInvitation: true });
      },
      onError: (err) => setError(httpStatus(err) === 401
        ? 'El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo.'
        : inviteError(err)),
    });
  };

  const acceptForExistingAccount = () => {
    setError('');
    acceptExisting.mutate({ data: { token } }, {
      onSuccess: (nextIdentity) => {
        tokenRef.current = '';
        clearPendingInvitation();
        setPassword('');
        onAuthenticated(nextIdentity);
      },
      onError: (err) => {
        if (httpStatus(err) === 410) { tokenRef.current = ''; clearPendingInvitation(); setFatal(inviteError(err)); }
        else setError(inviteError(err));
      },
    });
  };

  const rejectForExistingAccount = () => {
    setError('');
    rejectExisting.mutate({ data: { token } }, {
      onSuccess: () => {
        tokenRef.current = '';
        clearPendingInvitation();
        setPassword('');
        setOutcome('rejected');
      },
      onError: (err) => {
        if (httpStatus(err) === 410) { tokenRef.current = ''; clearPendingInvitation(); setFatal(inviteError(err)); }
        else setError(inviteError(err));
      },
    });
  };

  const signOutOtherAccount = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: getGetCurrentIdentityQueryKey(), exact: true });
        void identityQuery.refetch();
        setError('');
      },
      onError: (err) => setError(inviteError(err)),
    });
  };

  const invitationSummary = preview && <div className="auth-intro" data-testid="panel-invitation-review">
    <p>Red solicitada: <b data-testid="text-invite-network">RED FP360 · {preview.tenantId}</b></p>
    {preview.organizationName && <p>Organización: <b data-testid="text-invite-organization">{preview.organizationName}</b></p>}
    <p>Perfil solicitado: <b data-testid="text-invite-role">{accessRoleLabel(preview.role)}</b></p>
    <p>Invitación para: <b data-testid="text-invite-email">{preview.email}</b>. Caduca el {dateTime(preview.expiresAt)}.</p>
  </div>;

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
      </> : outcome === 'rejected' ? <>
        <h2>Invitación rechazada</h2>
        <p className="auth-intro">La invitación se ha rechazado. Tus accesos actuales no han cambiado.</p>
        <div className="auth-switch"><Link href="/">Volver al acceso</Link></div>
      </> : !preview ? <>
        <h2>Comprobando la invitación</h2>
        <div className="auth-skeleton" role="status" aria-label="Comprobando invitación" style={{ marginTop: 22 }}><span /><span /><span /></div>
      </> : preview.existingAccount ? <>
        <h2>{emailMatches ? 'Revisa el nuevo acceso' : 'Inicia sesión para revisar'}</h2>
        {invitationSummary}
        {identityQuery.isLoading ? <div className="auth-skeleton" role="status" aria-label="Comprobando sesión" style={{ marginTop: 22 }}><span /><span /><span /></div>
          : identityQuery.isError && httpStatus(identityQuery.error) !== 401 ? <div className="auth-error" role="alert"><CircleAlert size={17} /><span>No se pudo comprobar la sesión. Vuelve a cargar esta pantalla antes de aceptar.</span></div>
          : identity && !emailMatches ? <>
            <div className="auth-error" role="alert"><CircleAlert size={17} /><span>Hay una sesión abierta con otro correo. Cierra esa sesión para continuar con {preview.email}.</span></div>
            <button className="auth-submit" type="button" disabled={busy} onClick={signOutOtherAccount} data-testid="button-invite-sign-out">{logout.isPending ? 'Cerrando sesión…' : 'Cerrar la otra sesión'} <X size={16} /></button>
          </> : emailMatches ? <>
            <p className="auth-intro">Aceptar añadirá esta pertenencia a tu cuenta y abrirá la red invitante. El resto de tus accesos no se modificará.</p>
            {error && <div className="auth-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
            <div className="auth-form">
              <button className="auth-submit" type="button" disabled={busy} onClick={acceptForExistingAccount} data-testid="button-accept-existing-invitation">{acceptExisting.isPending ? 'Guardando acceso…' : 'Aceptar acceso'} {!acceptExisting.isPending && <ArrowRight size={16} />}</button>
              <button className="auth-submit" type="button" disabled={busy} onClick={rejectForExistingAccount} data-testid="button-reject-existing-invitation">{rejectExisting.isPending ? 'Registrando rechazo…' : 'Rechazar invitación'}</button>
            </div>
          </> : <>
            <p className="auth-intro">Primero inicia sesión con la cuenta que recibirá este acceso. La invitación no cambia tus pertenencias hasta que la aceptes.</p>
            <form className="auth-form" onSubmit={signIn}>
              <label className="auth-field"><span>Correo electrónico</span><input type="email" autoComplete="username" value={preview.email} readOnly data-testid="input-invite-login-email" /></label>
              <label className="auth-field"><span>Contraseña</span><input type="password" autoComplete="current-password" required minLength={1} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-invite-login-password" /></label>
              {error && <div className="auth-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
              <button className="auth-submit" type="submit" disabled={busy} data-testid="button-invite-login">{login.isPending ? 'Comprobando acceso…' : 'Iniciar sesión y revisar'} {!login.isPending && <ArrowRight size={16} />}</button>
              <div className="auth-trust"><ShieldCheck size={16} /><span>Iniciar sesión no acepta la invitación. Podrás revisar y decidir después.</span></div>
            </form>
          </>}
      </> : <>
        <h2>Crea tu cuenta</h2>
        {invitationSummary}
        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field"><span>Nombre completo</span><input autoComplete="name" required minLength={1} maxLength={100} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Cómo te verá tu equipo" data-testid="input-invite-name" /></label>
          <label className="auth-field"><span>Contraseña</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Al menos 12 caracteres" data-testid="input-invite-password" /></label>
          <label className="auth-field"><span>Repite la contraseña</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-invite-confirm" /></label>
          {error && <div className="auth-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
          <button className="auth-submit" type="submit" disabled={accept.isPending} data-testid="button-accept-invitation">{accept.isPending ? 'Creando cuenta…' : 'Crear cuenta y entrar'} {!accept.isPending && <ArrowRight size={16} />}</button>
          <div className="auth-trust"><ShieldCheck size={16} /><span>La sesión se mantiene con una cookie segura del servidor. No guardamos credenciales en este dispositivo.</span></div>
        </form>
        <div className="auth-switch"><span>La cuenta para esta invitación aún no existe. Si ya tienes cuenta con otro correo, inicia sesión primero.</span></div>
      </>}
    </div></div></section>
  </main>;
}
