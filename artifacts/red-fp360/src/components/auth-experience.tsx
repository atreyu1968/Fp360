import { type FormEvent, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useLogin, useSetupInitialAdministrator } from '@workspace/api-client-react';
import type { AuthIdentity } from '@workspace/api-client-react';
import { Link } from 'wouter';

type AuthExperienceProps = {
  mode: 'sign-in' | 'setup' | 'setup-complete';
  onAuthenticated: (identity: AuthIdentity) => void;
  setupEnabled?: boolean;
};

function statusOf(error: unknown) {
  if (error && typeof error === 'object' && 'status' in error) return Number((error as { status: unknown }).status);
  return 0;
}

function authError(error: unknown, setup = false) {
  const status = statusOf(error);
  if (status === 401) return setup ? 'El token de configuración o los datos no son válidos. Comprueba la información e inténtalo de nuevo.' : 'El correo o la contraseña no coinciden. Revisa los datos e inténtalo de nuevo.';
  if (status === 403) return setup ? 'El token de configuración no es válido o la solicitud no está permitida. Revisa el token e inténtalo de nuevo.' : 'El acceso no está permitido. Contacta con la persona responsable del centro.';
  if (status === 404 || (setup && status === 503)) return 'El servidor no ha habilitado la configuración inicial. Contacta con la persona responsable del centro.';
  if (status === 409) return setup ? 'La configuración inicial ya se completó. Inicia sesión con la cuenta de administración existente.' : 'No se pudo iniciar sesión con esos datos. Revisa el correo y la contraseña.';
  if (status === 429) return 'Se han realizado demasiados intentos. Espera un momento antes de volver a intentarlo.';
  if (status >= 500) return 'El servicio de acceso no está disponible ahora. Inténtalo de nuevo más tarde.';
  if (error instanceof TypeError || status === 0) return 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
  return 'No se pudo completar el acceso. Revisa los datos e inténtalo de nuevo.';
}

export function AuthExperience({ mode, onAuthenticated, setupEnabled = true }: AuthExperienceProps) {
  const login = useLogin();
  const setup = useSetupInitialAdministrator();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');

  const handleSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    login.mutate({ data: { email: email.trim(), password } }, {
      onSuccess: onAuthenticated,
      onError: (reason) => setError(authError(reason)),
    });
  };

  const handleSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!setupEnabled) {
      setError('El servidor no ha habilitado la configuración inicial. No es posible crear la cuenta desde aquí.');
      return;
    }
    setup.mutate({ data: { email: email.trim(), displayName: displayName.trim(), password, setupToken } }, {
      onSuccess: onAuthenticated,
      onError: (reason) => setError(authError(reason, true)),
    });
  };

  const isSetup = mode === 'setup';
  const isComplete = mode === 'setup-complete';
  const pending = login.isPending || setup.isPending;

  return <main className="auth-page">
    <section className="auth-visual" aria-label="RED FP360, aprendizaje empresarial simulado">
      <div className="auth-brand">
        <span className="brand-mark"><span>R</span><i /></span>
        <span className="brand-name"><b>RED FP360</b><small>EMPRESA SIMULADA · FP</small></span>
      </div>
      <div className="auth-art" aria-hidden="true">
        <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" />
        <div className="auth-node auth-node-a" /><div className="auth-node auth-node-b" />
        <div className="auth-node auth-node-c" /><div className="auth-node auth-node-d" />
        <div className="auth-gridline" />
        <div className="auth-art-label"><span /> RED EDUCATIVA · CANARIAS</div>
      </div>
      <div className="auth-story">
        <p className="auth-eyebrow">APRENDER HACIENDO</p>
        <h1>Ideas de aula.<br /><em>Decisiones de empresa.</em></h1>
        <p>Un espacio de prácticas para que los equipos aprendan a gestionar empresas ficticias y el profesorado pueda acompañar cada paso.</p>
      </div>
      <div className="auth-visual-foot"><span>Simulación educativa</span><span>·</span><span>Canarias</span></div>
    </section>

    <section className="auth-main">
      <div className="auth-card-wrap">
        <div className="auth-card">
          <div className="auth-card-mark" aria-hidden="true">{isComplete ? <CheckCircle2 size={20} /> : isSetup ? <KeyRound size={20} /> : <LockKeyhole size={20} />}</div>
          <p className="auth-overline">{isComplete ? 'CONFIGURACIÓN' : isSetup ? 'PRIMER ACCESO' : 'ESPACIO DE TRABAJO'}</p>
          <h2>{isComplete ? 'La configuración ya está completa' : isSetup ? 'Prepara el acceso del centro' : 'Qué bueno tenerte de vuelta'}</h2>
          <p className="auth-intro">{isComplete
            ? 'La configuración inicial ya no está habilitada. Si ya existe una cuenta, inicia sesión para continuar.'
            : isSetup
              ? 'Crea la primera cuenta de administración. Este paso solo está disponible cuando el servidor lo habilita.'
              : 'Accede con la cuenta que te ha facilitado tu centro educativo.'}</p>

          {isComplete ? <div className="auth-complete">
            <div className="auth-success"><CheckCircle2 size={18} /><span>El alta inicial no está disponible porque ya se completó.</span></div>
            <Link className="auth-submit" href="/sign-in" data-testid="link-go-sign-in">Ir a iniciar sesión <ArrowRight size={16} /></Link>
          </div> : isSetup && !setupEnabled ? <div className="auth-disabled" role="status" data-testid="status-setup-disabled">
            <CircleAlert size={19} /><div><strong>Configuración no habilitada</strong><p>El servidor no ha activado el alta inicial. Se requiere una habilitación y un token de configuración del administrador del sistema.</p></div>
          </div> : <form className="auth-form" onSubmit={isSetup ? handleSetup : handleSignIn}>
            {isSetup && <label className="auth-field"><span>Nombre completo</span><input data-testid="input-display-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={1} maxLength={100} placeholder="Nombre de la persona administradora" /></label>}
            <label className="auth-field"><span>Correo electrónico</span><input data-testid="input-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="nombre@centro.edu" /></label>
            {isSetup && <label className="auth-field"><span>Token de configuración</span><input data-testid="input-setup-token" type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} required minLength={32} maxLength={256} placeholder="Token facilitado por el responsable del sistema" /><small>Obligatorio. No compartas este token ni lo guardes en un equipo compartido.</small></label>}
            <label className="auth-field"><span>Contraseña</span><input data-testid="input-password" type="password" autoComplete={isSetup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={isSetup ? 12 : 1} maxLength={128} placeholder={isSetup ? 'Al menos 12 caracteres' : 'Tu contraseña'} /></label>
            {error && <div className="auth-error" role="alert" data-testid="status-auth-error"><CircleAlert size={17} /><span>{error}</span></div>}
            <button className="auth-submit" type="submit" disabled={pending || (isSetup && !setupEnabled)} data-testid="button-auth-submit">
              {pending ? 'Comprobando acceso…' : isSetup ? 'Crear cuenta inicial' : 'Iniciar sesión'} {!pending && <ArrowRight size={16} />}
            </button>
            {isSetup && <div className="auth-trust"><ShieldCheck size={16} /><span>La sesión se mantiene mediante una cookie segura del servidor. No guardamos credenciales en este dispositivo.</span></div>}
          </form>}

          {!isComplete && <div className="auth-switch">{isSetup
            ? <span>¿Ya tienes una cuenta? <Link href="/sign-in" data-testid="link-auth-sign-in">Inicia sesión</Link></span>
            : <span>¿Es el primer acceso de este centro? <Link href="/setup" data-testid="link-auth-setup">Configuración inicial</Link></span>}
          </div>}
        </div>
        <div className="auth-footnote"><ShieldCheck size={15} /><span>RED FP360 es un simulador educativo. No realiza operaciones bancarias, fiscales ni gubernamentales reales.</span></div>
      </div>
    </section>
  </main>;
}
