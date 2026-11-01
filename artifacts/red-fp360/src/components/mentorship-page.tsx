import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, BadgeCheck, BookOpenCheck, Building2, CalendarDays, CheckCircle2,
  ClipboardCheck, FileCheck2, FileText, History, Lightbulb, LockKeyhole, Plus, ShieldCheck,
  Users, X,
} from 'lucide-react';
import {
  getGetMentorshipOverviewQueryKey, useActOnMentorChallenge, useActOnMentorSession,
  useCreateMentorEntity, useCreateMentorEvidence, useCreateMentorChallenge,
  useCreateMentorRecommendation, useCreateMentorReview, useCreateMentorSession,
  useGetMentorshipOverview, useUpdateMentorAgreement, useUpdateMentorRecommendation,
} from '@workspace/api-client-react';
import type { MentorEntity, MentorSession, MentorshipOverview } from '@workspace/api-client-react';
import './mentorship-page.css';

type View = 'entities' | 'agenda' | 'challenges' | 'reviews' | 'evidence' | 'impact';
type Props = { identity: { role: string; organizationId?: string }; onNotice(message: string): void };
const views: { id: View; title: string; eyebrow: string; icon: typeof Activity }[] = [
  { id: 'entities', title: 'Entidades colaboradoras', eyebrow: 'RED PROFESIONAL', icon: Building2 },
  { id: 'agenda', title: 'Agenda de mentorías', eyebrow: 'ENCUENTROS', icon: CalendarDays },
  { id: 'challenges', title: 'Banco de retos', eyebrow: 'CASOS DIDÁCTICOS', icon: Lightbulb },
  { id: 'reviews', title: 'Revisión profesional', eyebrow: 'APRENDIZAJE', icon: ClipboardCheck },
  { id: 'evidence', title: 'Evidencias de participación', eyebrow: 'TRAZABILIDAD', icon: FileCheck2 },
  { id: 'impact', title: 'Transferencia e impacto', eyebrow: 'RESULTADOS', icon: Activity },
];
const labels: Record<string, string> = {
  draft: 'Borrador', pending_review: 'Pendiente de revisión', approved: 'Aprobado', revoked: 'Revocado',
  proposed: 'Propuesto', confirmed: 'Confirmado', completed: 'Realizado', cancelled: 'Cancelado',
  validated: 'Validado', returned: 'Devuelto', assigned: 'Asignado', closed: 'Cerrado',
  accepted: 'Aceptada', implemented: 'Aplicada', rejected: 'Descartada',
  basic: 'Inicial', intermediate: 'Intermedio', advanced: 'Avanzado',
  company: 'Empresa', professional_association: 'Asociación profesional', institution: 'Institución', other: 'Otra entidad',
  in_person: 'Presencial', remote: 'En línea simulada', document_review: 'Revisión de material',
  minutes: 'Acta didáctica', materials: 'Materiales', attendance_aggregate: 'Asistencia agregada', deliverable: 'Entregable',
};
const opId = () => crypto.randomUUID();
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la acción. Revisa los permisos e inténtalo de nuevo.';
const dateText = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const statusText = (value: string) => labels[value] ?? value.replaceAll('_', ' ');
const fields = (event: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(event.currentTarget).entries());
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="mt-empty"><span><FileText size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Skeleton() { return <div className="mt-skeleton" aria-label="Cargando mentoría"><i /><i /><i /><i /></div>; }
function SectionHead({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <header className="mt-section-head"><div><span className="mt-overline">{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div>{action}</header>;
}
function Status({ value }: { value: string }) { return <span className={`mt-status mt-status-${value}`} data-testid={`status-mentorship-${value}`}>{statusText(value)}</span>; }
function Field({ label, name, required, type = 'text', hint, defaultValue, options, area = false }: {
  label: string; name: string; required?: boolean; type?: string; hint?: string; defaultValue?: string;
  options?: { value: string; label: string }[]; area?: boolean;
}) {
  return <label className="mt-field"><span>{label}{required ? ' · Obligatorio' : ''}</span>{options ?
    <select name={name} defaultValue={defaultValue ?? options[0]?.value} required={required} data-testid={`select-mentorship-${name}`}>{options.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select> :
    area ? <textarea name={name} rows={3} required={required} defaultValue={defaultValue} aria-label={label} data-testid={`textarea-mentorship-${name}`} /> :
      <input name={name} type={type} required={required} defaultValue={defaultValue} aria-label={label} data-testid={`input-mentorship-${name}`} />}
    {hint && <small>{hint}</small>}</label>;
}

export default function MentorshipPage({ identity, onNotice }: Props) {
  const client = useQueryClient();
  const [view, setView] = useState<View>('entities');
  const [campaignId, setCampaignId] = useState('');
  const [form, setForm] = useState<View | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const params = campaignId ? { campaignId } : undefined;
  const overview = useGetMentorshipOverview(params, { query: { queryKey: getGetMentorshipOverviewQueryKey(params) } });
  const createEntity = useCreateMentorEntity();
  const updateAgreement = useUpdateMentorAgreement();
  const createSession = useCreateMentorSession();
  const actSession = useActOnMentorSession();
  const createChallenge = useCreateMentorChallenge();
  const actChallenge = useActOnMentorChallenge();
  const createReview = useCreateMentorReview();
  const createEvidence = useCreateMentorEvidence();
  const createRecommendation = useCreateMentorRecommendation();
  const updateRecommendation = useUpdateMentorRecommendation();
  const data = overview.data as MentorshipOverview | undefined;
  const role = identity.role;
  const isStudent = role === 'student';
  const isManager = role === 'team_manager';
  const external = role === 'mentor' || role === 'promoter';
  const capabilities = data?.capabilities ?? {
    canManageEntities: false, canSchedule: false, canProposeChallenges: false, canReview: false,
    canRecordEvidence: false, canManageTransfer: false, canViewAudit: false,
  };
  const campaign = data?.campaigns.find((item) => item.id === campaignId) ?? data?.campaigns[0];
  const effectiveCampaignId = campaign?.id ?? '';
  const visibleViews = views;
  const organizations = (data?.organizations ?? []).filter((item) =>
    !identity.organizationId || !isManager || item.id === identity.organizationId);
  const entities = data?.entities ?? [];
  const sessions = (data?.sessions ?? []).filter((item) => !isManager || item.organizationId === identity.organizationId);
  const challenges = (data?.challenges ?? []).filter((item) => !isManager || item.organizationId === identity.organizationId);
  const evidence = data?.evidence ?? [];
  const reviews = data?.reviews ?? [];
  const recommendations = data?.recommendations ?? [];
  const busy = createEntity.isPending || updateAgreement.isPending || createSession.isPending || actSession.isPending ||
    createChallenge.isPending || actChallenge.isPending || createReview.isPending || createEvidence.isPending ||
    createRecommendation.isPending || updateRecommendation.isPending;
  const notify = (text: string, error = false) => { setNotice({ text, error }); onNotice(text); };
  const invalidate = () => { void client.invalidateQueries({ queryKey: getGetMentorshipOverviewQueryKey() }); };
  const failure = (error: unknown) => notify(errorText(error), true);
  const success = (text: string) => { setForm(null); notify(text); invalidate(); };
  const entityName = (entityId: string) => {
    const entity = entities.find((item) => item.id === entityId);
    return entity?.publishNameAuthorized ? entity.name : 'Entidad colaboradora';
  };
  const campaignOptions = data?.campaigns ?? [];
  const submit = (event: FormEvent<HTMLFormElement>, action: (values: Record<string, FormDataEntryValue>) => void) => {
    event.preventDefault();
    if (busy) return;
    action(fields(event));
  };
  const mutationOptions = (text: string) => ({ onSuccess: () => success(text), onError: failure });

  const createEntityForm = <form className="mt-form" onSubmit={(event) => submit(event, (v) => createEntity.mutate({ data: {
    operationId: opId(), name: String(v.name).trim(), kind: String(v.kind) as 'company', linkedOrganizationId: v.linkedOrganizationId ? String(v.linkedOrganizationId) : null,
    areas: String(v.areas).split(',').map((x) => x.trim()).filter(Boolean), agreementReference: String(v.agreementReference).trim(),
    contactName: String(v.contactName).trim(), contactRole: String(v.contactRole).trim(), publishNameAuthorized: v.publishNameAuthorized === 'on',
    validFrom: v.validFrom ? String(v.validFrom) : null, validUntil: v.validUntil ? String(v.validUntil) : null,
  } }, mutationOptions('Entidad colaboradora registrada.')))} data-testid="form-mentorship-entity">
    <h3>Nueva entidad colaboradora</h3><div className="mt-form-grid"><Field label="Nombre de entidad" name="name" required />
      <Field label="Tipo" name="kind" options={['company','professional_association','institution','other'].map((v) => ({ value:v,label:statusText(v) }))} />
      <Field label="Organización vinculada" name="linkedOrganizationId" options={[{value:'',label:'Sin vincular'},...organizations.map((o) => ({value:o.id,label:o.name}))]} />
      <Field label="Áreas profesionales" name="areas" required hint="Separa las áreas con comas; no incluyas datos personales." />
      <Field label="Referencia de acuerdo" name="agreementReference" required /><Field label="Persona referente (nombre)" name="contactName" required />
      <Field label="Rol profesional de referencia" name="contactRole" required /><Field label="Vigente desde" name="validFrom" type="date" />
      <Field label="Vigente hasta" name="validUntil" type="date" /></div>
    <label className="mt-check"><input name="publishNameAuthorized" type="checkbox" data-testid="checkbox-mentorship-publish-name" />Autorización expresa para mostrar el nombre en informes compartidos externos</label>
    <div className="mt-form-foot"><span>No se solicitan teléfonos ni correos. Referencia didáctica, no acuerdo legal.</span><button className="mt-button primary" disabled={busy} data-testid="button-save-mentorship-entity"><Plus size={14} />{createEntity.isPending?'Guardando…':'Registrar entidad'}</button></div>
  </form>;

  const sessionForm = <form className="mt-form" onSubmit={(event) => submit(event, (v) => createSession.mutate({ data: {
    operationId: opId(), campaignId: effectiveCampaignId, organizationId: String(v.organizationId), entityId: String(v.entityId),
    objective: String(v.objective).trim(), modality: String(v.modality) as 'in_person', scheduledDate: String(v.scheduledDate), scheduledTime: String(v.scheduledTime),
    groupLabel: String(v.groupLabel).trim(), participantCount: Number(v.participantCount), materialSummary: String(v.materialSummary ?? '').trim(),
  } }, mutationOptions('Sesión propuesta en la agenda.')))} data-testid="form-mentorship-session">
    <h3>Proponer encuentro formativo</h3><div className="mt-form-grid"><Field label="Organización" name="organizationId" required options={organizations.map((o) => ({value:o.id,label:o.name}))} />
      <Field label="Entidad mentora" name="entityId" required options={entities.map((e) => ({value:e.id,label:e.name}))} />
      <Field label="Fecha simulada" name="scheduledDate" type="date" required /><Field label="Hora" name="scheduledTime" type="time" required />
      <Field label="Modalidad" name="modality" options={['in_person','remote','document_review'].map((v) => ({value:v,label:statusText(v)}))} />
      <Field label="Equipo / grupo" name="groupLabel" required /><Field label="Participantes agregados" name="participantCount" type="number" required defaultValue="1" />
      <Field label="Objetivo de la mentoría" name="objective" required area /><Field label="Material de referencia (resumen)" name="materialSummary" area hint="No adjuntes ni cargues documentos." /></div>
    <div className="mt-form-foot"><span>La participación se registra como dato agregado.</span><button className="mt-button primary" disabled={busy || !effectiveCampaignId} data-testid="button-save-mentorship-session"><CalendarDays size={14} />{createSession.isPending?'Guardando…':'Proponer sesión'}</button></div>
  </form>;

  const challengeForm = <form className="mt-form" onSubmit={(event) => submit(event, (v) => createChallenge.mutate({ data: {
    operationId: opId(), campaignId: effectiveCampaignId, entityId: String(v.entityId), organizationId: v.organizationId ? String(v.organizationId) : null,
    simulationEventId: null, title: String(v.title).trim(), sector: String(v.sector).trim(), level: String(v.level) as 'basic',
    anonymizedSummary: String(v.anonymizedSummary).trim(), isAnonymized: true,
  } }, mutationOptions('Reto didáctico propuesto.')))} data-testid="form-mentorship-challenge">
    <h3>Proponer un reto anonimizado</h3><div className="mt-form-grid"><Field label="Entidad" name="entityId" required options={entities.map((e) => ({value:e.id,label:e.name}))} />
      <Field label="Organización destinataria" name="organizationId" options={[{value:'',label:'Sin asignar'},...organizations.map((o) => ({value:o.id,label:o.name}))]} />
      <Field label="Título" name="title" required /><Field label="Sector" name="sector" required />
      <Field label="Nivel" name="level" options={['basic','intermediate','advanced'].map((v) => ({value:v,label:statusText(v)}))} />
      <Field label="Resumen anonimizado del reto" name="anonymizedSummary" required area hint="No escribas nombres, datos personales ni expedientes." /></div>
    <div className="mt-form-foot"><span>Este caso solo representa una situación formativa.</span><button className="mt-button primary" disabled={busy || !effectiveCampaignId} data-testid="button-save-mentorship-challenge"><Plus size={14} />{createChallenge.isPending?'Guardando…':'Proponer reto'}</button></div>
  </form>;

  const reviewForm = <form className="mt-form" onSubmit={(event) => submit(event, (v) => createReview.mutate({ data: {
    operationId: opId(), challengeId: String(v.challengeId), decision: String(v.decision) as 'approved', observation: String(v.observation).trim(),
  } }, mutationOptions('Revisión profesional registrada.')))} data-testid="form-mentorship-review">
    <h3>Registrar revisión profesional</h3><div className="mt-form-grid"><Field label="Reto" name="challengeId" required options={challenges.map((c) => ({value:c.id,label:c.title}))} />
      <Field label="Decisión" name="decision" options={[{value:'approved',label:'Aprobado'},{value:'returned',label:'Devuelto para ajuste'}]} />
      <Field label="Observación profesional" name="observation" required area /></div>
    <div className="mt-form-foot"><span>La revisión no es una evaluación ni calificación docente.</span><button className="mt-button primary" disabled={busy} data-testid="button-save-mentorship-review"><ClipboardCheck size={14} />{createReview.isPending?'Guardando…':'Registrar revisión'}</button></div>
  </form>;

  const evidenceForm = <form className="mt-form" onSubmit={(event) => submit(event, (v) => createEvidence.mutate({ data: {
    operationId: opId(), campaignId: effectiveCampaignId, sessionId: v.sessionId ? String(v.sessionId) : null, challengeId: v.challengeId ? String(v.challengeId) : null,
    kind: String(v.kind) as 'minutes', summary: String(v.summary).trim(), participantCount: Number(v.participantCount),
    documentId: v.documentId ? String(v.documentId) : null, simulatedDate: String(v.simulatedDate),
  } }, mutationOptions('Evidencia de participación registrada.')))} data-testid="form-mentorship-evidence">
    <h3>Registrar participación agregada</h3><div className="mt-form-grid"><Field label="Sesión relacionada" name="sessionId" options={[{value:'',label:'Sin sesión'},...sessions.map((s) => ({value:s.id,label:`${s.objective} · ${dateText(s.scheduledDate)}`}))]} />
      <Field label="Reto relacionado" name="challengeId" options={[{value:'',label:'Sin reto'},...challenges.map((c) => ({value:c.id,label:c.title}))]} />
      <Field label="Tipo de evidencia" name="kind" options={['minutes','materials','attendance_aggregate','deliverable'].map((v) => ({value:v,label:statusText(v)}))} />
      <Field label="Participantes (agregado)" name="participantCount" type="number" required defaultValue="0" />
      <Field label="Fecha simulada" name="simulatedDate" type="date" required />
      <Field label="Documento sintético confirmado" name="documentId" options={[{value:'',label:'Sin documento vinculado'},...(data?.eligibleDocuments ?? []).map((doc) => ({value:doc.id,label:`${doc.reference} · ${doc.title}`}))]} hint="Solo documentos confirmados ofrecidos por el servicio." />
      <Field label="Resumen de la evidencia" name="summary" required area /></div>
    <div className="mt-form-foot"><span>No se cargan archivos ni se registran asistentes por nombre.</span><button className="mt-button primary" disabled={busy || !effectiveCampaignId} data-testid="button-save-mentorship-evidence"><FileCheck2 size={14} />{createEvidence.isPending?'Guardando…':'Registrar evidencia'}</button></div>
  </form>;

  const recommendationForm = <form className="mt-form" onSubmit={(event) => submit(event, (v) => createRecommendation.mutate({ data: {
    operationId: opId(), reviewId: String(v.reviewId), text: String(v.text).trim(),
  } }, mutationOptions('Recomendación de transferencia registrada.')))} data-testid="form-mentorship-recommendation">
    <h3>Registrar transferencia útil</h3><div className="mt-form-grid"><Field label="Revisión de origen" name="reviewId" required options={reviews.map((r) => ({value:r.id,label:`${entityName(r.entityId)} · ${dateText(r.createdAt)}`}))} />
      <Field label="Recomendación" name="text" required area /></div>
    <div className="mt-form-foot"><span>Registrar una práctica transferible, sin datos de alumnado.</span><button className="mt-button primary" disabled={busy} data-testid="button-save-mentorship-recommendation"><Plus size={14} />{createRecommendation.isPending?'Guardando…':'Guardar recomendación'}</button></div>
  </form>;

  const actionSession = (session: MentorSession, action: 'confirm'|'reschedule'|'complete'|'cancel') => actSession.mutate({
    id: session.id, data: { operationId: opId(), action, reason: `Acción didáctica: ${statusText(action)}.` },
  }, mutationOptions(`Sesión: ${statusText(action).toLocaleLowerCase('es')}.`));
  const actionChallenge = (id: string, action: 'validate'|'return'|'assign'|'close') => actChallenge.mutate({
    id, data: { operationId: opId(), action, targetOrganizationId: null, reason: `Acción didáctica: ${statusText(action)}.` },
  }, mutationOptions(`Reto actualizado: ${statusText(action).toLocaleLowerCase('es')}.`));
  const sessionActions = (session: MentorSession) => <div className="mt-actions">{capabilities?.canSchedule && session.status === 'proposed' && <button className="mt-button mini" disabled={busy} onClick={() => actionSession(session,'confirm')} data-testid={`button-confirm-session-${session.id}`}>Confirmar</button>}
    {capabilities?.canSchedule && session.status === 'confirmed' && <button className="mt-button mini" disabled={busy} onClick={() => actionSession(session,'complete')} data-testid={`button-complete-session-${session.id}`}>Registrar realización</button>}
    {capabilities?.canSchedule && ['proposed','confirmed'].includes(session.status) && <button className="mt-button mini warn" disabled={busy} onClick={() => actionSession(session,'cancel')} data-testid={`button-cancel-session-${session.id}`}>Cancelar propuesta</button>}</div>;
  const challengeActions = (challenge: (typeof challenges)[number]) => <div className="mt-actions">{capabilities?.canReview && challenge.status === 'proposed' && <><button className="mt-button mini" disabled={busy} onClick={() => actionChallenge(challenge.id,'validate')} data-testid={`button-validate-challenge-${challenge.id}`}>Validar</button><button className="mt-button mini warn" disabled={busy} onClick={() => actionChallenge(challenge.id,'return')} data-testid={`button-return-challenge-${challenge.id}`}>Devolver</button></>}
    {capabilities?.canReview && challenge.status === 'validated' && <button className="mt-button mini" disabled={busy} onClick={() => actionChallenge(challenge.id,'assign')} data-testid={`button-assign-challenge-${challenge.id}`}>Asignar</button>}
    {capabilities?.canReview && ['validated','assigned'].includes(challenge.status) && <button className="mt-button mini quiet" disabled={busy} onClick={() => actionChallenge(challenge.id,'close')} data-testid={`button-close-challenge-${challenge.id}`}>Cerrar reto</button>}</div>;

  return <main className="mt-page page-enter" data-testid="mentorship-page">
    <header className="mt-hero"><div className="mt-hero-top"><span>RED FP360 <i>/</i> COLABORACIÓN PROFESIONAL</span><span className="mt-sim-pill"><ShieldCheck size={13} /> ENTORNO FORMATIVO SIMULADO</span></div>
      <div className="mt-hero-body"><div><span className="mt-kicker">MÓDULO 24 · APRENDIZAJE CON PROFESIONALES</span><h1>Mentoría <em>empresarial</em></h1>
        <p>Un espacio de aula para preparar encuentros, trabajar retos y conservar aprendizajes compartidos con el tejido profesional.</p></div>
        <div className="mt-hero-stamp"><small>REGISTRO DIDÁCTICO</small><strong>24</strong><span>RED FP360</span></div></div>
      <div className="mt-hero-foot"><span>Canarias · colaboración educativa</span><span>Sin mensajería real, contactos personales ni expedientes de alumnado.</span></div></header>
    <div className="mt-notice-band"><ShieldCheck size={16} /><span><b>Simulación y privacidad.</b> Los registros son didácticos. Las revisiones profesionales no califican al alumnado. Las vistas y operaciones se limitan por permisos del centro.</span></div>
    <nav className="mt-toolbar" aria-label="Vistas de mentoría"><div className="mt-nav" role="tablist" aria-label="Secciones de mentoría">
      {visibleViews.map(({id,title,eyebrow,icon:Icon}) => <button key={id} type="button" role="tab" aria-selected={view===id} className={view===id?'active':''} onClick={() => {setView(id);setForm(null);}} data-testid={`tab-mentorship-${id}`}><Icon size={15} /><span><small>{eyebrow}</small>{title}</span></button>)}</div>
      <label className="mt-campaign"><span className="sr-only">Filtrar campaña</span><select aria-label="Filtrar por campaña" value={campaignId || campaign?.id || ''} onChange={(event) => setCampaignId(event.target.value)} data-testid="select-mentorship-campaign"><option value="">Seleccionar campaña</option>{campaignOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></nav>
    {notice && <div className={`mt-notice ${notice.error?'error':''}`} role={notice.error?'alert':'status'} data-testid="status-mentorship-notice">{notice.error?<AlertCircle size={16}/>:<CheckCircle2 size={16}/>}<span>{notice.text}</span><button aria-label="Cerrar aviso" onClick={() => setNotice(null)} data-testid="button-dismiss-mentorship-notice"><X size={14}/></button></div>}
    {overview.isLoading && <section className="mt-panel"><Skeleton /></section>}
    {overview.isError && <div className="mt-error" role="alert"><AlertCircle size={17}/><span>No se pudo cargar la información de mentoría.</span><button onClick={() => void overview.refetch()} data-testid="button-retry-mentorship">Reintentar</button></div>}
    {!overview.isLoading && !overview.isError && data && <>
      <section className="mt-kpis" aria-label="Resumen de mentoría">
        <article><span className="mt-kpi-icon"><Users size={16}/></span><small>Sesiones propuestas</small><b data-testid="value-mentorship-sessions-planned">{data.impact.sessionsPlanned}</b><span>Agenda autorizada</span></article>
        <article><span className="mt-kpi-icon teal"><BadgeCheck size={16}/></span><small>Sesiones realizadas</small><b data-testid="value-mentorship-sessions-completed">{data.impact.sessionsCompleted}</b><span>Colaboración formativa</span></article>
        <article><span className="mt-kpi-icon amber"><BookOpenCheck size={16}/></span><small>Retos validados</small><b data-testid="value-mentorship-challenges">{data.impact.challengesValidated}</b><span>Casos anonimizados</span></article>
        <article><span className="mt-kpi-icon green"><Activity size={16}/></span><small>Transferencia aplicada</small><b data-testid="value-mentorship-transfer-rate">{data.impact.transferRate}%</b><span>{data.impact.recommendationsImplemented} recomendaciones aplicadas</span></article>
      </section>
      {isManager && <div className="mt-bottom-note"><LockKeyhole size={14}/>Vista de coordinación: solo datos de la organización y participación agregada.</div>}
      {isStudent && <div className="mt-bottom-note"><LockKeyhole size={14}/>Se muestran únicamente registros autorizados por el servicio para tu participación.</div>}
      {external && <div className="mt-bottom-note"><LockKeyhole size={14}/>Vista profesional asignada. No se muestran nombres de alumnado ni expedientes personales.</div>}

      {view==='entities' && <section className="mt-panel"><SectionHead eyebrow="RED PROFESIONAL" title="Entidades colaboradoras" detail="Entidades y acuerdos habilitados para colaborar en el escenario educativo." action={capabilities.canManageEntities && <button className="mt-button primary" onClick={() => setForm(form==='entities'?null:'entities')} data-testid="button-open-entity-form"><Plus size={14}/>Registrar entidad</button>} />
        {form==='entities' && createEntityForm}
        {isManager ? <Empty title="Vista agregada de la organización" detail={`${entities.length} entidades colaboradoras disponibles en el alcance autorizado. No se muestran entidades, personas ni acuerdos individuales.`}/> : entities.length ? <div className="mt-entity-grid">{entities.map((entity: MentorEntity) => <article className="mt-entity-card" key={entity.id} data-testid={`card-mentorship-entity-${entity.id}`}>
          <header><div><span className="mt-label">{statusText(entity.kind)}</span><h3>{entity.name}</h3></div><Status value={entity.agreementStatus}/></header>
          <p>{entity.areas.join(' · ')}{entity.validFrom ? ` · Vigencia ${dateText(entity.validFrom)}${entity.validUntil?` – ${dateText(entity.validUntil)}`:''}`:''}</p>
          <div className="mt-meta"><span>Acuerdo {entity.agreementReference}</span><span>Referencia: {entity.contactRole}</span></div>
          {capabilities.canManageEntities && entity.agreementStatus!=='approved' && <div className="mt-actions"><button className="mt-button mini" disabled={busy} onClick={() => updateAgreement.mutate({id:entity.id,data:{operationId:opId(),agreementStatus:'approved',reason:'Acuerdo revisado para colaboración didáctica.'}},mutationOptions('Acuerdo aprobado para el entorno formativo.'))} data-testid={`button-approve-agreement-${entity.id}`}>Aprobar acuerdo</button>
            {entity.agreementStatus==='pending_review' && <button className="mt-button mini warn" disabled={busy} onClick={() => updateAgreement.mutate({id:entity.id,data:{operationId:opId(),agreementStatus:'revoked',reason:'Acuerdo no habilitado para este escenario didáctico.'}},mutationOptions('Acuerdo revocado.'))} data-testid={`button-revoke-agreement-${entity.id}`}>Revocar</button>}</div>}
        </article>)}</div> : <Empty title="Sin entidades colaboradoras" detail="El servicio mostrará aquí las entidades habilitadas para esta campaña y este perfil."/>}
        <div className="mt-bottom-note"><LockKeyhole size={14}/>Los nombres de entidad solo se incluyen en informes compartidos cuando existe autorización de publicación.</div>
      </section>}

      {view==='agenda' && <section className="mt-panel"><SectionHead eyebrow="ENCUENTROS FORMATIVOS" title="Agenda de mentorías" detail="Encuentros simulados con propósito, grupo y participación agregada." action={capabilities.canSchedule && <button className="mt-button primary" onClick={() => setForm(form==='agenda'?null:'agenda')} data-testid="button-open-session-form"><Plus size={14}/>Proponer sesión</button>}/>
        {form==='agenda' && sessionForm}
        {isManager ? <div className="mt-impact-grid"><article className="mt-impact"><small>Sesiones de la organización</small><b>{sessions.length}</b></article><article className="mt-impact"><small>Participación agregada</small><b>{sessions.reduce((sum, item) => sum + item.participantCount, 0)}</b></article></div> : sessions.length ? <div className="mt-card-list">{sessions.map((session) => <article className="mt-record" key={session.id} data-testid={`card-mentorship-session-${session.id}`}><div className="mt-record-main"><span className="mt-label">{dateText(session.scheduledDate)} · {session.scheduledTime}</span><h3>{session.objective}</h3><p>{session.groupLabel} · {session.participantCount} participantes · {statusText(session.modality)}</p><div className="mt-meta"><span>{entityName(session.entityId)}</span><span>{session.materialSummary || 'Sin resumen de materiales'}</span></div></div><div className="mt-stack"><Status value={session.status}/>{sessionActions(session)}</div></article>)}</div> : <Empty title="Agenda sin encuentros" detail="Las propuestas de sesión autorizadas aparecerán aquí cuando se registren desde este módulo."/>}
      </section>}

      {view==='challenges' && <section className="mt-panel"><SectionHead eyebrow="CASOS ANONIMIZADOS" title="Banco de retos" detail="Problemas profesionales en formato didáctico, sin datos identificables." action={capabilities.canProposeChallenges && <button className="mt-button primary" onClick={() => setForm(form==='challenges'?null:'challenges')} data-testid="button-open-challenge-form"><Plus size={14}/>Proponer reto</button>}/>
        {form==='challenges' && challengeForm}
        {isManager ? <Empty title="Retos resumidos" detail={`${challenges.length} retos en el alcance de la organización. El detalle de casos no está disponible en la vista agregada.`}/> : challenges.length ? <div className="mt-card-list">{challenges.map((challenge) => <article className="mt-record" key={challenge.id} data-testid={`card-mentorship-challenge-${challenge.id}`}><div className="mt-record-main"><span className="mt-label">{challenge.sector} · Nivel {statusText(challenge.level)}</span><h3>{challenge.title}</h3><p>{challenge.anonymizedSummary}</p><div className="mt-meta"><span>{entityName(challenge.entityId)}</span></div></div><div className="mt-stack"><Status value={challenge.status}/>{challengeActions(challenge)}</div></article>)}</div> : <Empty title="El banco está vacío" detail="No hay retos disponibles para esta campaña. Solo se registran casos didácticos anonimizados."/>}
      </section>}

      {view==='reviews' && <section className="mt-panel"><SectionHead eyebrow="CRITERIO PROFESIONAL" title="Revisión profesional" detail="Observaciones sobre retos y su utilidad formativa; no constituyen evaluación docente ni calificación." action={capabilities.canReview && <button className="mt-button primary" onClick={() => setForm(form==='reviews'?null:'reviews')} data-testid="button-open-review-form"><Plus size={14}/>Registrar revisión</button>}/>
        {form==='reviews' && reviewForm}
        {isManager ? <Empty title="Revisiones en agregado" detail={`${reviews.length} revisiones registradas. Las observaciones individuales no se muestran a coordinación.`}/> : reviews.length ? <div className="mt-card-list">{reviews.map((review) => <article className="mt-record" key={review.id} data-testid={`card-mentorship-review-${review.id}`}><div className="mt-record-main"><span className="mt-label">{dateText(review.createdAt)} · {entityName(review.entityId)}</span><h3>{review.reviewerLabel}</h3><p>{review.observation}</p></div><Status value={review.decision}/></article>)}</div> : <Empty title="Aún no hay revisiones" detail="Las observaciones profesionales se mostrarán aquí tras el registro autorizado."/>}
        <div className="mt-bottom-note"><ShieldCheck size={14}/>El criterio profesional acompaña el aprendizaje. No es una evaluación académica o laboral.</div>
      </section>}

      {view==='evidence' && <section className="mt-panel"><SectionHead eyebrow="PARTICIPACIÓN AGREGADA" title="Evidencias de participación" detail="Registra actas, materiales o entregables; se conserva únicamente el número agregado de participantes." action={capabilities.canRecordEvidence && <button className="mt-button primary" onClick={() => setForm(form==='evidence'?null:'evidence')} data-testid="button-open-evidence-form"><Plus size={14}/>Registrar evidencia</button>}/>
        {form==='evidence' && evidenceForm}
        {isManager ? <div className="mt-impact-grid"><article className="mt-impact"><small>Evidencias de la organización</small><b>{evidence.length}</b></article><article className="mt-impact"><small>Participación agregada</small><b>{evidence.reduce((sum, item) => sum + item.participantCount, 0)}</b></article></div> : evidence.length ? <div className="mt-table-scroll"><table className="mt-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Resumen</th><th>Participación</th><th>Documento sintético</th></tr></thead><tbody>{evidence.map((item) => <tr key={item.id} data-testid={`row-mentorship-evidence-${item.id}`}><td>{dateText(item.simulatedDate)}</td><td>{statusText(item.kind)}</td><td><strong>{item.summary}</strong></td><td>{item.participantCount} participantes</td><td>{item.documentReference || 'Sin documento vinculado'}</td></tr>)}</tbody></table></div> : <Empty title="Sin evidencias registradas" detail="Las evidencias didácticas aparecerán tras su registro. No se adjuntan archivos ni se identifican asistentes."/>}
        <div className="mt-bottom-note"><LockKeyhole size={14}/>Solo se pueden vincular documentos sintéticos confirmados proporcionados por el servicio. No se realizan cargas.</div>
      </section>}

      {view==='impact' && <div className="mt-stack"><section className="mt-panel"><SectionHead eyebrow="TRANSFERENCIA E IMPACTO" title="Aprendizaje que permanece" detail="Indicadores agregados devueltos por el servicio para la campaña y el alcance autorizado."/>
          <div className="mt-impact-grid"><article className="mt-impact"><small>Sesiones planificadas</small><b data-testid="impact-sessions-planned">{data.impact.sessionsPlanned}</b></article><article className="mt-impact"><small>Sesiones realizadas</small><b data-testid="impact-sessions-completed">{data.impact.sessionsCompleted}</b></article><article className="mt-impact"><small>Retos validados</small><b data-testid="impact-challenges-validated">{data.impact.challengesValidated}</b></article><article className="mt-impact"><small>Recomendaciones aplicadas</small><b data-testid="impact-recommendations-implemented">{data.impact.recommendationsImplemented}</b></article><article className="mt-impact"><small>Tasa de transferencia</small><b data-testid="impact-transfer-rate">{data.impact.transferRate}%</b></article></div>
          {capabilities.canManageTransfer && !isManager && recommendationForm}
          {isManager ? <Empty title="Transferencia en agregado" detail={`${recommendations.length} recomendaciones registradas; ${data.impact.recommendationsImplemented} aplicadas. No se muestra el contenido individual.`}/> : recommendations.length ? <div className="mt-card-list">{recommendations.map((item) => <article className="mt-record" key={item.id} data-testid={`card-mentorship-recommendation-${item.id}`}><div className="mt-record-main"><span className="mt-label">{dateText(item.createdAt)}</span><h3>{item.text}</h3></div><div className="mt-stack"><Status value={item.status}/>{capabilities.canManageTransfer && item.status==='proposed' && <div className="mt-actions">{(['accepted','implemented','rejected'] as const).map((status) => <button className="mt-button mini" key={status} disabled={busy} onClick={() => updateRecommendation.mutate({id:item.id,data:{operationId:opId(),status,reason:`Seguimiento didáctico: ${statusText(status)}.`}},mutationOptions(`Recomendación marcada como ${statusText(status).toLocaleLowerCase('es')}.`))} data-testid={`button-recommendation-${status}-${item.id}`}>{statusText(status)}</button>)}</div>}</div></article>)}</div> : <Empty title="Sin recomendaciones de transferencia" detail="Las recomendaciones derivadas de revisiones profesionales aparecerán cuando se registren."/>}
          <div className="mt-bottom-note"><ShieldCheck size={14}/>Los informes compartidos fuera del centro deben ser agregados. El nombre de una entidad requiere autorización expresa.</div>
        </section>
        {capabilities.canViewAudit && !isManager && <section className="mt-panel"><SectionHead eyebrow="TRAZABILIDAD" title="Registro de actividad" detail="Eventos del módulo disponibles para este rol."/>
          {data.audit.length ? <div className="mt-audit">{data.audit.map((item) => <article key={item.id} data-testid={`audit-mentorship-${item.id}`}><span><History size={14}/></span><div><small>{dateText(item.createdAt)} · {item.actorLabel} · {item.resourceType}</small><b>{item.action}</b><p>{item.summary}</p></div></article>)}</div> : <Empty title="Sin actividad auditada" detail="El servicio no ha devuelto eventos de auditoría para este alcance."/>}
        </section>}
      </div>}
    </>}
  </main>;
}
