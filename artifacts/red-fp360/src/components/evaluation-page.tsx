import { useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, BadgeCheck, BookOpen, CheckCircle2, ChevronRight, ClipboardCheck,
  Clock3, Download, FileClock, FileText, Filter, Gauge, History, LockKeyhole, Plus, Printer,
  RotateCcw, Scale, Search, ShieldCheck, Users, X,
} from 'lucide-react';
import {
  getGetEvaluationOverviewQueryKey, useAssignEvaluationActivityCriteria, useCloseEvaluationGroup,
  useCreateEvaluationAssessment, useCreateEvaluationCriterion, useCreateEvaluationRubric,
  useGetEvaluationOverview, usePublishEvaluationRubric, useReviseEvaluationCriterion,
  useUpdateEvaluationGroupSettings, useValidateEvaluationWeights,
} from '@workspace/api-client-react';
import type {
  EvaluationAssessment, EvaluationCampaign, EvaluationCriterion, EvaluationEntry, EvaluationGroup,
  EvaluationRubric, EvaluationRubricLevel,
} from '@workspace/api-client-react';
import { Form } from '@/components/ui/form';
import './evaluation-page.css';

type View = 'group' | 'map' | 'rubrics' | 'queue' | 'student' | 'reports' | 'audit';
type Props = { identity: { role: string; organizationId?: string }; onNotice: (message: string) => void };
type CriterionFormValues = {
  learningOutcomeCode: string; learningOutcomeTitle: string; code: string; title: string;
  weight: number; minimumScore: number; minimumEvidenceCount: number;
};
type RubricFormValues = {
  criterionId: string; title: string;
  level1Label: string; level1Score: number; level1Descriptor: string;
  level2Label: string; level2Score: number; level2Descriptor: string;
  level3Label: string; level3Score: number; level3Descriptor: string;
  level4Label: string; level4Score: number; level4Descriptor: string;
};
type AssessFormValues = { rubricId: string; rubricLevelId: string; feedback: string; reason: string };
type CloseFormValues = { confirmationPhrase: string; reason: string };

const closePhrase = 'CERRAR EVALUACIÓN';
const views: { id: View; title: string; eyebrow: string; icon: typeof Gauge }[] = [
  { id: 'group', title: 'Cuadro del grupo', eyebrow: 'SEGUIMIENTO', icon: Gauge },
  { id: 'map', title: 'Mapa RA-criterios', eyebrow: 'CURRÍCULO', icon: ClipboardCheck },
  { id: 'rubrics', title: 'Banco de rúbricas', eyebrow: 'INSTRUMENTOS', icon: BookOpen },
  { id: 'queue', title: 'Corrección de operaciones', eyebrow: 'EVIDENCIAS', icon: Activity },
  { id: 'student', title: 'Ficha del estudiante', eyebrow: 'RESULTADOS', icon: Users },
  { id: 'reports', title: 'Informes y exportación', eyebrow: 'INFORMES', icon: FileText },
  { id: 'audit', title: 'Auditoría de evaluación', eyebrow: 'TRAZABILIDAD', icon: History },
];
const statusLabel: Record<string, string> = {
  draft: 'Borrador', in_progress: 'En curso', closed: 'Cerrado',
  achieved: 'Criterio alcanzado', recovery_required: 'Recuperación necesaria',
};
const dateLabel = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la acción. Conservamos los datos; revisa permisos e inténtalo de nuevo.';
const sortedAssessments = (items: EvaluationAssessment[]) => [...items].sort((a, b) => a.attemptNumber - b.attemptNumber || a.createdAt.localeCompare(b.createdAt));
const latestForCriterion = (entry: EvaluationEntry, criterionId: string) =>
  sortedAssessments(entry.assessments.filter((assessment) => assessment.criterionId === criterionId)).at(-1);
const displayScore = (assessment?: EvaluationAssessment) => assessment ? `${assessment.score} / ${assessment.scoreScale}` : '—';
const escapeCsv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const filenameDate = () => new Date().toISOString().slice(0, 10);

function Status({ value }: { value: string }) {
  const label = statusLabel[value] ?? value.replaceAll('_', ' ');
  return <span className={`ev-status ev-status-${value}`} data-testid={`status-evaluation-${value}`}><i />{label}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="ev-empty"><span><FileText size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Skeleton() {
  return <div className="ev-skeleton" aria-label="Cargando evaluación"><i /><i /><i /><i /></div>;
}
function SectionHead({ overline, title, detail, action }: { overline: string; title: string; detail?: string; action?: ReactNode }) {
  return <header className="ev-section-head"><div><span className="ev-overline">{overline}</span><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>;
}
function Notice({ text, error, onDismiss }: { text: string; error?: boolean; onDismiss: () => void }) {
  return <div className={`ev-notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} data-testid="status-evaluation-notice">{error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{text}<button onClick={onDismiss} aria-label="Cerrar aviso" data-testid="button-dismiss-evaluation-notice"><X size={14} /></button></div>;
}

export default function EvaluationPage({ identity, onNotice }: Props) {
  const queryClient = useQueryClient();
  const [campaignId, setCampaignId] = useState('');
  const [view, setView] = useState<View>(identity.role === 'student' ? 'student' : 'group');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [selectedCriterionId, setSelectedCriterionId] = useState('');
  const [selectedRubricId, setSelectedRubricId] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [modal, setModal] = useState<'criterion' | 'rubric' | 'assessment' | 'close' | null>(null);
  const [weightResult, setWeightResult] = useState<{ valid: boolean; total: number; count: number } | null>(null);
  const [activitySelection, setActivitySelection] = useState<Record<string, string[]>>({});
  const notify = (text: string, error = false) => { setNotice({ text, error }); onNotice(text); };

  const params = campaignId ? { campaignId } : undefined;
  const overview = useGetEvaluationOverview(params, { query: { queryKey: getGetEvaluationOverviewQueryKey(params) } });
  const createCriterion = useCreateEvaluationCriterion();
  const reviseCriterion = useReviseEvaluationCriterion();
  const validateWeights = useValidateEvaluationWeights();
  const updateSettings = useUpdateEvaluationGroupSettings();
  const createRubric = useCreateEvaluationRubric();
  const publishRubric = usePublishEvaluationRubric();
  const assignActivity = useAssignEvaluationActivityCriteria();
  const createAssessment = useCreateEvaluationAssessment();
  const closeGroup = useCloseEvaluationGroup();

  const data = overview.data;
  const campaigns = data?.campaigns ?? [];
  const campaign = campaigns.find((item) => item.id === campaignId) ?? campaigns[0];
  const effectiveCampaignId = campaign?.id ?? '';
  const group: EvaluationGroup | undefined = data?.groups.find((item) => item.campaignId === effectiveCampaignId);
  const criteria = (data?.criteria ?? []).filter((item) => item.campaignId === effectiveCampaignId);
  const rubrics = (data?.rubrics ?? []).filter((item) => item.campaignId === effectiveCampaignId);
  const activities = (data?.activities ?? []).filter((item) => item.campaignId === effectiveCampaignId);
  const entries = (data?.entries ?? []).filter((item) => item.campaignId === effectiveCampaignId);
  const audit = (data?.audit ?? []).filter((item) => item.campaignId === effectiveCampaignId);
  const capabilities = data?.capabilities;
  const role = identity.role;
  const isStudent = role === 'student';
  const isManager = role === 'team_manager';
  const canConfigure = capabilities?.canConfigure === true;
  const canEvaluate = capabilities?.canEvaluate === true;
  const canViewAudit = capabilities?.canViewAudit === true;
  const canClose = capabilities?.canClose === true;
  const hasAssessments = entries.some((entry) => entry.assessments.length > 0);
  const scoreScale = group?.scoreScale ?? 10;

  const selectedEntry = entries.find((entry) => entry.portfolioEntryId === selectedEntryId) ?? entries[0];
  const selectedCriterion = criteria.find((item) => item.id === selectedCriterionId) ?? criteria[0];
  const visibleViews = views.filter((item) => {
    if (isStudent) return item.id === 'student' || item.id === 'reports';
    return true;
  });
  const normalizedSearch = search.trim().toLocaleLowerCase('es');
  const filteredEntries = entries.filter((entry) => isManager ||
    `${entry.activityTitle} ${entry.entryStatus} ${entry.evidenceDocumentReference}`.toLocaleLowerCase('es').includes(normalizedSearch));
  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);
  const unassessedEntries = filteredEntries.filter((entry) => entry.entryStatus === 'submitted' || entry.entryStatus === 'validated');
  const assessmentsTotal = entries.reduce((sum, entry) => sum + entry.assessments.length, 0);
  const achievedCount = entries.reduce((sum, entry) => sum + entry.assessments.filter((item) => item.status === 'achieved').length, 0);
  const recoveryCount = entries.reduce((sum, entry) => sum + entry.assessments.filter((item) => item.status === 'recovery_required').length, 0);
  const studentNames = [...new Set(entries.map((item) => item.studentName))];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetEvaluationOverviewQueryKey() });
  };
  const mutationError = (error: unknown) => notify(errorMessage(error), true);
  const success = (text: string) => { setModal(null); notify(text); invalidate(); };

  const criterionForm = useForm<CriterionFormValues>({
    defaultValues: { learningOutcomeCode: '', learningOutcomeTitle: '', code: '', title: '', weight: 0, minimumScore: 5, minimumEvidenceCount: 1 },
  });
  const reviseForm = useForm<CriterionFormValues>({
    defaultValues: { learningOutcomeCode: '', learningOutcomeTitle: '', code: '', title: '', weight: 0, minimumScore: 5, minimumEvidenceCount: 1 },
  });
  const rubricForm = useForm<RubricFormValues>({
    defaultValues: {
      criterionId: '', title: '', level1Label: 'Inicial', level1Score: 25, level1Descriptor: '',
      level2Label: 'En desarrollo', level2Score: 50, level2Descriptor: '',
      level3Label: 'Competente', level3Score: 75, level3Descriptor: '',
      level4Label: 'Avanzado', level4Score: 100, level4Descriptor: '',
    },
  });
  const assessmentForm = useForm<AssessFormValues>({ defaultValues: { rubricId: '', rubricLevelId: '', feedback: '', reason: '' } });
  const closeForm = useForm<CloseFormValues>({ defaultValues: { confirmationPhrase: '', reason: '' } });

  const criterionValues = (values: CriterionFormValues) => ({
    campaignId: effectiveCampaignId, learningOutcomeCode: values.learningOutcomeCode.trim(),
    learningOutcomeTitle: values.learningOutcomeTitle.trim(), code: values.code.trim(), title: values.title.trim(),
    weight: Number(values.weight), minimumScore: Number(values.minimumScore), minimumEvidenceCount: Number(values.minimumEvidenceCount),
  });
  const addCriterion = criterionForm.handleSubmit((values) => {
    if (!effectiveCampaignId) return;
    createCriterion.mutate({ data: criterionValues(values) }, {
      onSuccess: () => { criterionForm.reset(); setWeightResult(null); success('Criterio creado como nueva versión curricular.'); },
      onError: mutationError,
    });
  });
  const saveRevision = reviseForm.handleSubmit((values) => {
    if (!selectedCriterion) return;
    reviseCriterion.mutate({ id: selectedCriterion.id, data: criterionValues(values) }, {
      onSuccess: () => { reviseForm.reset(); setWeightResult(null); success('Nueva versión del criterio guardada; el historial anterior permanece intacto.'); },
      onError: mutationError,
    });
  });
  const checkWeights = () => {
    if (!effectiveCampaignId) return;
    validateWeights.mutate({ data: { campaignId: effectiveCampaignId } }, {
      onSuccess: (result) => {
        setWeightResult({ valid: result.valid, total: result.totalWeight, count: result.criterionCount });
        notify(result.valid ? 'La ponderación del grupo suma el 100 %.' : `La ponderación actual suma ${result.totalWeight} %. Ajusta los pesos antes de evaluar.`, !result.valid);
        invalidate();
      }, onError: mutationError,
    });
  };
  const saveRubric = rubricForm.handleSubmit((values) => {
    const levels: EvaluationRubricLevel[] = [1, 2, 3, 4].map((n) => ({
      id: `nivel-${n}`, label: values[`level${n}Label` as keyof RubricFormValues] as string,
      score: Number(values[`level${n}Score` as keyof RubricFormValues]),
      descriptor: values[`level${n}Descriptor` as keyof RubricFormValues] as string,
    }));
    createRubric.mutate({ data: { criterionId: values.criterionId, title: values.title.trim(), levels } }, {
      onSuccess: () => { rubricForm.reset(); success('Borrador de rúbrica guardado. Publícala para fijar esta versión.'); },
      onError: mutationError,
    });
  });

  const selectedRubric = rubrics.find((item) => item.id === selectedRubricId);
  const currentAssessment = selectedEntry && selectedCriterion ? latestForCriterion(selectedEntry, selectedCriterion.id) : undefined;
  const assessmentRubricOptions = rubrics.filter((item) => item.isPublished && item.criterionId === selectedCriterion?.id);
  const openAssessment = (entry: EvaluationEntry, criterionId?: string, recovery = false) => {
    setSelectedEntryId(entry.portfolioEntryId);
    if (criterionId) setSelectedCriterionId(criterionId);
    const criterion = criteria.find((item) => item.id === criterionId) ?? criteria[0];
    const publishedRubric = rubrics.find((item) => item.isPublished && item.criterionId === criterion?.id);
    setSelectedRubricId(publishedRubric?.id ?? '');
    assessmentForm.reset({ rubricId: publishedRubric?.id ?? '', rubricLevelId: '', feedback: '', reason: recovery ? 'Recuperación específica de criterio' : '' });
    setModal('assessment');
  };
  const assess = assessmentForm.handleSubmit((values) => {
    if (!selectedEntry || !selectedCriterion) return;
    const rubric = rubrics.find((item) => item.id === values.rubricId && item.isPublished);
    if (!rubric) { notify('Selecciona una rúbrica publicada para valorar la evidencia.', true); return; }
    const latest = latestForCriterion(selectedEntry, selectedCriterion.id);
    const isRecovery = latest?.status === 'recovery_required';
    createAssessment.mutate({ data: {
      portfolioEntryId: selectedEntry.portfolioEntryId, criterionId: selectedCriterion.id, rubricId: rubric.id,
      rubricLevelId: values.rubricLevelId, feedback: values.feedback.trim(), reason: values.reason.trim(),
      isRecovery,
    } }, {
      onSuccess: () => success(isRecovery ? 'Nuevo intento de recuperación registrado en el historial.' : 'Valoración por criterio añadida al historial.'),
      onError: mutationError,
    });
  });

  const saveScale = (value: 10 | 100) => {
    if (!effectiveCampaignId || hasAssessments || !canConfigure) return;
    updateSettings.mutate({ campaignId: effectiveCampaignId, data: { scoreScale: value } }, {
      onSuccess: () => { notify(`Escala simulada configurada: ${value} puntos.`); invalidate(); }, onError: mutationError,
    });
  };
  const saveActivityCriteria = (eventId: string) => {
    const criterionIds = activitySelection[eventId] ?? activities.find((activity) => activity.eventId === eventId)?.criterionIds ?? [];
    if (!criterionIds.length) { notify('Selecciona al menos un criterio para vincular la actividad.', true); return; }
    assignActivity.mutate({ eventId, data: { criterionIds } }, {
      onSuccess: () => success('Actividad vinculada a los criterios seleccionados.'), onError: mutationError,
    });
  };
  const closeGroupSubmit = closeForm.handleSubmit((values) => {
    if (values.confirmationPhrase !== closePhrase || values.reason.trim().length < 10 || !effectiveCampaignId) return;
    closeGroup.mutate({ campaignId: effectiveCampaignId, data: { confirmationPhrase: closePhrase, reason: values.reason.trim() } }, {
      onSuccess: () => { closeForm.reset(); success('Grupo cerrado como registro didáctico. No es un acta oficial.'); }, onError: mutationError,
    });
  });

  const exportCsv = () => {
    let rows: string[][];
    if (isManager) {
      rows = [['Campaña', 'Evidencias', 'Criterios pendientes de recuperación', 'Intentos registrados'],
        [campaign?.title ?? '', String(entries.length), String(recoveryCount), String(assessmentsTotal)]];
    } else {
      rows = [['Estudiante', 'Actividad', 'Referencia de evidencia', 'Criterio', 'Intento', 'Puntuación', 'Escala', 'Estado', 'Comentario', 'Fecha']];
      entries.forEach((entry) => entry.assessments.forEach((assessment) => rows.push([
        entry.studentName, entry.activityTitle, entry.evidenceDocumentReference, assessment.criterionTitle,
        String(assessment.attemptNumber), String(assessment.score), String(assessment.scoreScale),
        statusLabel[assessment.status] ?? assessment.status, assessment.feedback, dateLabel(assessment.createdAt),
      ])));
    }
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `evaluacion-${filenameDate()}.csv`; anchor.click();
    URL.revokeObjectURL(url);
    notify('Archivo CSV generado con la información permitida para este perfil.');
  };
  const printReport = () => { window.print(); };
  const groupLatest = (entry: EvaluationEntry) => entry.assessments.reduce<EvaluationAssessment | undefined>((latest, item) =>
    !latest || item.createdAt > latest.createdAt ? item : latest, undefined);
  const studentEntries = useMemo(() => entries, [entries]);
  const reportRows = isManager ? [] : entries.flatMap((entry) => entry.assessments.map((assessment) => ({ entry, assessment })));
  const statusCount = (status: string) => entries.filter((entry) => entry.entryStatus === status).length;
  return <main className="evaluation-page page-enter" data-testid="evaluation-page">
    <header className="ev-hero">
      <div className="ev-hero-top"><span>RED FP360 <i>/</i> EVALUACIÓN DOCENTE</span><span className="ev-sim-pill"><ShieldCheck size={13} /> ENTORNO FORMATIVO SIMULADO</span></div>
      <div className="ev-hero-body"><div><span className="ev-kicker">MÓDULO 23 · RESULTADOS DE APRENDIZAJE</span><h1>Evaluación <em>docente</em></h1>
        <p>Valora actuaciones verificables del ERP con criterios, rúbricas publicadas y trazabilidad por intento.</p></div>
        <div className="ev-hero-stamp"><small>CAMPAÑA ACTIVA</small><strong>{campaign ? '01' : '—'}</strong><span>{campaign?.status ?? 'Sin seleccionar'}</span></div></div>
      <div className="ev-hero-foot"><span>{campaign?.title ?? 'RED EDUCATIVA · CANARIAS'}</span><span>Evaluación educativa; no sustituye una calificación oficial ni un acta académica.</span></div>
    </header>

    <nav className="ev-toolbar" aria-label="Navegación y filtros de evaluación">
      <div className="ev-nav" role="tablist" aria-label="Vistas de evaluación">
        {visibleViews.map(({ id, title, eyebrow, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)} data-testid={`tab-evaluation-${id}`}><Icon size={15} /><span><small>{eyebrow}</small>{title}</span></button>)}
      </div>
      <label className="ev-campaign"><Filter size={14} /><span className="sr-only">Seleccionar campaña</span><select value={campaignId || campaign?.id || ''} onChange={(event) => { setCampaignId(event.target.value); setSelectedEntryId(''); setWeightResult(null); }} aria-label="Filtrar campaña" data-testid="select-evaluation-campaign"><option value="">Seleccionar campaña</option>{campaigns.map((item: EvaluationCampaign) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    </nav>

    {notice && <Notice text={notice.text} error={notice.error} onDismiss={() => setNotice(null)} />}
    {overview.isLoading && <section className="ev-panel"><Skeleton /></section>}
    {overview.isError && <div className="ev-error" role="alert"><AlertCircle size={17} /><span>No se pudo cargar la evaluación docente.</span><button onClick={() => void overview.refetch()} data-testid="button-retry-evaluation">Reintentar</button></div>}
    {!overview.isLoading && !overview.isError && <>
      {!effectiveCampaignId ? <section className="ev-panel"><Empty title="No hay campañas disponibles" detail="Las campañas y sus registros aparecerán según el alcance autorizado por el servicio." /></section> : <>
        <section className={`ev-kpis ${isManager ? 'aggregate-only' : ''}`} aria-label="Indicadores de evaluación">
          <article><span className="ev-kpi-icon"><Users size={16} /></span><small>{isManager ? 'Participantes con registro' : 'Estudiantes con evidencia'}</small><b>{isManager ? studentNames.length : studentNames.length}</b><span>En el grupo seleccionado</span></article>
          <article><span className="ev-kpi-icon teal"><FileText size={16} /></span><small>Evidencias recibidas</small><b>{entries.length}</b><span>Registros vinculados a portafolio</span></article>
          <article><span className="ev-kpi-icon amber"><Clock3 size={16} /></span><small>Intentos registrados</small><b>{assessmentsTotal}</b><span>Se conserva cada intento</span></article>
          <article><span className="ev-kpi-icon green"><BadgeCheck size={16} /></span><small>Criterios por recuperar</small><b>{recoveryCount}</b><span>Intentos específicos por criterio</span></article>
        </section>

        {view === 'group' && <div className="ev-dashboard">
          <section className="ev-panel ev-group-panel"><SectionHead overline="SEGUIMIENTO DEL GRUPO" title="Actividad evaluable" detail="Resultados provisionales atribuidos a evidencias reales." action={canClose && group?.status !== 'closed' ? <button className="ev-button danger-outline" onClick={() => { closeForm.reset(); setModal('close'); }} data-testid="button-open-close-group"><LockKeyhole size={14} /> Cerrar grupo</button> : undefined} />
            {isManager ? <div className="ev-manager-summary"><div><small>Estado del grupo</small><b><Status value={group?.status ?? 'draft'} /></b></div><div><small>Avance de evaluación</small><b>{entries.length ? `${assessmentsTotal} valoraciones · ${recoveryCount} recuperaciones` : 'Sin valoraciones registradas'}</b></div><div><small>Participación</small><b>{studentNames.length} participantes con evidencia</b></div><p><LockKeyhole size={14} /> Este perfil solo consulta indicadores agregados; no muestra nombres, puntuaciones ni resultados individuales.</p></div>
              : entries.length ? <div className="ev-table-scroll"><table className="ev-data-table"><thead><tr><th>Estudiante</th><th>Evidencia / actividad</th><th>Criterios valorados</th><th>Última puntuación</th><th>Estado</th></tr></thead><tbody>{entries.map((entry) => {
                const latest = groupLatest(entry);
                return <tr key={entry.portfolioEntryId} data-testid={`row-evaluation-entry-${entry.portfolioEntryId}`}><td><button className="ev-student-link" onClick={() => { setSelectedEntryId(entry.portfolioEntryId); setView('student'); }} data-testid={`button-open-profile-${entry.portfolioEntryId}`}>{entry.studentName}<small>Ficha individual</small></button></td><td><b>{entry.activityTitle}</b><small className="ev-table-sub">{entry.evidenceDocumentReference || 'Evidencia vinculada'}</small></td><td>{new Set(entry.assessments.map((assessment) => assessment.criterionId)).size} / {criteria.length}</td><td>{displayScore(latest)}<small className="ev-table-sub">Provisional · {latest?.rubricLevelLabel ?? 'Sin valorar'}</small></td><td><Status value={entry.entryStatus} /></td></tr>;
              })}</tbody></table></div> : <Empty title="Aún no hay evidencias de evaluación" detail="Las operaciones enviadas desde el portafolio de la campaña aparecerán aquí." />}
            <div className="ev-group-foot"><span><span className={`ev-dot ${group?.status === 'closed' ? 'closed' : ''}`} />Grupo didáctico · {statusLabel[group?.status ?? 'draft']}</span>{group?.closedAt && <span>Cierre registrado el {dateLabel(group.closedAt)}</span>}</div>
          </section>
          <aside className="ev-dashboard-aside">
            <section className="ev-panel"><div className="ev-aside-heading"><span>ESTADO DE EVALUACIÓN</span><b>{criteria.length ? Math.round((achievedCount / Math.max(1, entries.length * criteria.length)) * 100) : 0}<small>%</small></b></div><p>Avance de criterios alcanzados en evidencias registradas; no representa una nota final.</p><div className="ev-progress"><i style={{ transform: `scaleX(${criteria.length ? Math.min(1, achievedCount / Math.max(1, entries.length * criteria.length)) : 0})` }} /></div><div className="ev-legend"><span><i className="green" /> Alcanzado <b>{achievedCount}</b></span><span><i className="amber" /> Recuperación <b>{recoveryCount}</b></span></div></section>
            <section className="ev-callout"><div><ShieldCheck size={15} /> Trazabilidad didáctica</div><p>Cada valoración conserva su criterio, rúbrica publicada, persona evaluadora, comentario e intento.</p></section>
          </aside>
        </div>}

        {view === 'map' && <div className="ev-layout-stack">
            <section className="ev-panel"><SectionHead overline="CURRÍCULO · CANARIAS" title="Mapa RA–criterios" detail="Versiones curriculares, ponderaciones y vínculos a actividades." action={canConfigure ? <button className="ev-button primary" onClick={() => { setSelectedCriterionId(''); criterionForm.reset(); setModal('criterion'); }} data-testid="button-create-evaluation-criterion"><Plus size={14} /> Añadir criterio</button> : undefined} />
            <div className="ev-map-toolbar"><div className={`ev-weight-sum ${weightResult ? weightResult.valid ? 'valid' : 'invalid' : ''}`}><Scale size={15} /><span>Ponderación total</span><b>{totalWeight.toLocaleString('es-ES')} %</b><small>{weightResult ? `${weightResult.count} criterios · ${weightResult.valid ? 'validada' : 'revisar'}` : 'La validación se confirma en servidor'}</small></div>
              <div className="ev-map-actions">{canConfigure && <button className="ev-button quiet" onClick={checkWeights} disabled={validateWeights.isPending} data-testid="button-validate-weights"><CheckCircle2 size={14} />{validateWeights.isPending ? 'Validando…' : 'Validar pesos'}</button>}
                {canConfigure && group && !hasAssessments && <label className="ev-scale-select">Escala simulada<select value={scoreScale} onChange={(event) => saveScale(Number(event.target.value) as 10 | 100)} disabled={updateSettings.isPending} aria-label="Escala simulada" data-testid="select-score-scale"><option value={10}>0–10</option><option value={100}>0–100</option></select></label>}
              </div></div>
            {canConfigure && group && hasAssessments && <div className="ev-lock-note"><LockKeyhole size={14} /> Escala fijada en {scoreScale} puntos: ya existe el primer intento de evaluación.</div>}
            {weightResult && <div className={`ev-weight-result ${weightResult.valid ? 'valid' : 'invalid'}`} role="status"><CheckCircle2 size={15} />{weightResult.valid ? 'Pesos coherentes: el total alcanza el 100 %.' : `Total ${weightResult.total} %. La suma debe ser exactamente 100 % antes de evaluar.`}</div>}
            {criteria.length ? <div className="ev-ra-map">{[...new Map(criteria.map((item) => [item.learningOutcomeCode, item.learningOutcomeTitle])).entries()].map(([raCode, raTitle]) => {
              const outcomeCriteria = criteria.filter((item) => item.learningOutcomeCode === raCode);
              const weight = outcomeCriteria.reduce((sum, item) => sum + item.weight, 0);
              return <section className="ev-ra-group" key={raCode}><header><span className="ev-ra-code">{raCode}</span><div><h3>{raTitle}</h3><small>{outcomeCriteria.length} criterios · {weight}% ponderación</small></div><span className="ev-ra-total">{weight}%</span></header>
                <div className="ev-criteria-list">{outcomeCriteria.map((criterion) => <article key={criterion.id} className={selectedCriterion?.id === criterion.id ? 'selected' : ''} data-testid={`card-evaluation-criterion-${criterion.id}`}>
                  <button className="ev-criterion-main" onClick={() => { setSelectedCriterionId(criterion.id); reviseForm.reset({ learningOutcomeCode: criterion.learningOutcomeCode, learningOutcomeTitle: criterion.learningOutcomeTitle, code: criterion.code, title: criterion.title, weight: criterion.weight, minimumScore: criterion.minimumScore, minimumEvidenceCount: criterion.minimumEvidenceCount }); }} data-testid={`button-select-criterion-${criterion.id}`}><span className="ev-criterion-code">{criterion.code} · v{criterion.version}</span><b>{criterion.title}</b><small>{criterion.minimumEvidenceCount} evidencia(s) mínima(s) · umbral {criterion.minimumScore}</small></button>
                  <div className="ev-criterion-side"><b>{criterion.weight}%</b><small>{activities.filter((activity) => activity.criterionIds.includes(criterion.id)).length} actividades</small>{canConfigure && <button className="ev-text-action" onClick={() => { setSelectedCriterionId(criterion.id); reviseForm.reset({ learningOutcomeCode: criterion.learningOutcomeCode, learningOutcomeTitle: criterion.learningOutcomeTitle, code: criterion.code, title: criterion.title, weight: criterion.weight, minimumScore: criterion.minimumScore, minimumEvidenceCount: criterion.minimumEvidenceCount }); setModal('criterion'); }} data-testid={`button-revise-criterion-${criterion.id}`}>Nueva versión</button>}</div>
                </article>)}</div>
              </section>;
            })}</div> : <Empty title="No hay criterios configurados" detail="Añade los resultados de aprendizaje y criterios reales de la programación del grupo." />}
          </section>
          <section className="ev-panel"><SectionHead overline="FP360 SIM" title="Vincular actividades" detail="Asocia eventos de simulación a uno o varios criterios curriculares." />
            {activities.length ? <div className="ev-activity-map">{activities.map((activity) => <article key={activity.eventId} data-testid={`card-map-activity-${activity.eventId}`}><div><small>EVENTO COMPLETADO · {dateLabel(activity.completedAt)}</small><b>{activity.title}</b><span>{activity.eventType}</span></div><fieldset><legend>Criterios aplicables</legend>{criteria.map((criterion) => <label key={criterion.id}><input type="checkbox" checked={(activitySelection[activity.eventId] ?? activity.criterionIds).includes(criterion.id)} onChange={(event) => setActivitySelection((previous) => {
              const active = previous[activity.eventId] ?? activity.criterionIds;
              return { ...previous, [activity.eventId]: event.target.checked ? [...active, criterion.id] : active.filter((id) => id !== criterion.id) };
            })} data-testid={`checkbox-activity-criterion-${activity.eventId}-${criterion.id}`} /><span>{criterion.code} · {criterion.title}</span></label>)}</fieldset>{canConfigure && <button className="ev-button quiet" onClick={() => saveActivityCriteria(activity.eventId)} disabled={assignActivity.isPending} data-testid={`button-save-activity-map-${activity.eventId}`}>Guardar vínculo</button>}</article>)}</div> : <Empty title="Sin actividades vinculadas" detail="Los eventos completados de la campaña se mostrarán aquí cuando el servidor los devuelva." />}
          </section>
        </div>}

        {view === 'rubrics' && <section className="ev-panel"><SectionHead overline="INSTRUMENTOS · VERSIONADO" title="Banco de rúbricas" detail="Solo las rúbricas publicadas pueden usarse para registrar una valoración." action={canConfigure && criteria.length > 0 ? <button className="ev-button primary" onClick={() => { rubricForm.reset({ ...rubricForm.getValues(), criterionId: selectedCriterion?.id ?? criteria[0].id }); setModal('rubric'); }} data-testid="button-create-rubric"><Plus size={14} /> Crear rúbrica</button> : undefined} />
          {rubrics.length ? <div className="ev-rubric-layout"><div className="ev-rubric-list">{rubrics.map((rubric) => <button key={rubric.id} className={`ev-rubric-row ${selectedRubricId === rubric.id ? 'selected' : ''}`} onClick={() => setSelectedRubricId(rubric.id)} data-testid={`button-select-rubric-${rubric.id}`}><span className="ev-rubric-symbol"><BookOpen size={15} /></span><span><b>{rubric.title}</b><small>{criteria.find((item) => item.id === rubric.criterionId)?.code ?? 'Criterio'} · versión {rubric.version}</small></span><Status value={rubric.isPublished ? 'published' : 'draft'} /><ChevronRight size={14} /></button>)}</div>
            {selectedRubric ? <article className="ev-rubric-detail" data-testid={`panel-rubric-${selectedRubric.id}`}><header><div><span className="ev-overline">FICHA DE RÚBRICA</span><h3>{selectedRubric.title}</h3><p>{criteria.find((item) => item.id === selectedRubric.criterionId)?.title ?? 'Criterio curricular'} · v{selectedRubric.version}</p></div><Status value={selectedRubric.isPublished ? 'published' : 'draft'} /></header>
              <div className="ev-rubric-freeze">{selectedRubric.isPublished ? <><LockKeyhole size={14} /> Versión publicada y fijada desde {dateLabel(selectedRubric.publishedAt)}. No se modifica tras evaluar.</> : <><FileClock size={14} /> Borrador de trabajo. Publicar fija esta versión para uso en evaluación.</>}</div>
              <div className="ev-level-list">{selectedRubric.levels.map((level) => <article key={level.id}><span>{level.score}</span><div><b>{level.label}</b><p>{level.descriptor}</p></div></article>)}</div>
              {!selectedRubric.isPublished && canConfigure && <button className="ev-button primary" onClick={() => publishRubric.mutate({ id: selectedRubric.id }, { onSuccess: () => success('Rúbrica publicada y fijada para evaluaciones futuras.'), onError: mutationError })} disabled={publishRubric.isPending} data-testid={`button-publish-rubric-${selectedRubric.id}`}><LockKeyhole size={14} />{publishRubric.isPending ? 'Publicando…' : 'Publicar y fijar versión'}</button>}
            </article> : <div className="ev-rubric-detail"><Empty title="Selecciona una rúbrica" detail="Los descriptores y el estado de publicación se muestran aquí." /></div>}</div> : <Empty title="Banco sin rúbricas" detail="Crea una rúbrica vinculada a un criterio y publícala para poder evaluar." />}
        </section>}

        {view === 'queue' && <section className="ev-panel"><SectionHead overline="EVIDENCIA TRANSACCIONAL" title="Corrección de operaciones" detail={canEvaluate ? 'Revisa evidencias de portafolio y registra valoraciones por criterio.' : 'La corrección individual requiere permisos docentes.'} />
          {isManager ? <div className="ev-manager-summary compact"><p><LockKeyhole size={14} /> La cola individual está oculta para este perfil. Solo se muestran indicadores agregados.</p><b>{entries.length} evidencias · {assessmentsTotal} intentos registrados</b></div> :
          !canEvaluate ? <Empty title="Vista de solo lectura" detail="Tu perfil no dispone de permiso para corregir evidencias individuales." /> : <>
            <div className="ev-queue-tools"><label className="ev-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar actividad o estado…" aria-label="Buscar evidencias" data-testid="input-search-evaluation-queue" /></label><span>{unassessedEntries.length} evidencias pendientes o revisables</span></div>
            {filteredEntries.length ? <div className="ev-queue-list">{filteredEntries.map((entry) => {
              const activity = activities.find((item) => item.eventId === entry.eventId);
              const linkedCriteria = criteria.filter((criterion) => activity?.criterionIds.includes(criterion.id));
              return <article key={entry.portfolioEntryId} data-testid={`card-correction-${entry.portfolioEntryId}`}><div className="ev-queue-main"><span className="ev-queue-type">EVIDENCIA DE PORTAFOLIO · {entry.studentName}</span><h3>{entry.activityTitle}</h3><p>{entry.evidenceDocumentReference || 'Documento de origen vinculado'} · {entry.assessments.length} intentos registrados</p><div className="ev-assessed-chips">{entry.assessments.slice(-3).map((assessment) => <span key={assessment.id}>{assessment.criterionTitle}: {displayScore(assessment)} · {statusLabel[assessment.status]}</span>)}</div></div>
                <div className="ev-queue-actions"><Status value={entry.entryStatus} />{linkedCriteria.length ? linkedCriteria.map((criterion) => <button key={criterion.id} className="ev-button quiet mini" onClick={() => openAssessment(entry, criterion.id, latestForCriterion(entry, criterion.id)?.status === 'recovery_required')} disabled={group?.status === 'closed'} data-testid={`button-assess-${entry.portfolioEntryId}-${criterion.id}`}>{latestForCriterion(entry, criterion.id)?.status === 'recovery_required' ? <><RotateCcw size={13} /> Recuperar {criterion.code}</> : <>Valorar {criterion.code}</>}</button>) : <span className="ev-queue-warning">Sin criterios vinculados</span>}</div>
              </article>;
            })}</div> : <Empty title="Cola sin evidencias" detail="Las evidencias reales del portafolio aparecerán tras completarse una actividad y enviarse a revisión." />}
          </>}
        </section>}

        {view === 'student' && <section className="ev-panel"><SectionHead overline="RESULTADOS INDIVIDUALES" title="Ficha del estudiante" detail={isStudent ? 'Tus propios resultados, criterios valorados e intentos registrados.' : isManager ? 'El acceso individual está restringido para este perfil.' : 'Desempeño por criterio, evidencias y recuperación; sin promedios no configurados.'} />
          {isManager ? <Empty title="Ficha individual no disponible" detail="El perfil de responsable de equipo consulta solo resúmenes agregados; no accede a nombres ni puntuaciones." /> :
            entries.length ? <div className="ev-student-layout"><aside className="ev-student-picker">{!isStudent && <><label className="ev-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar estudiante o actividad…" aria-label="Buscar estudiantes" data-testid="input-search-student" /></label>{entries.filter((entry) => `${entry.studentName} ${entry.activityTitle}`.toLocaleLowerCase('es').includes(normalizedSearch)).map((entry) => <button key={entry.portfolioEntryId} className={`ev-student-option ${selectedEntry?.portfolioEntryId === entry.portfolioEntryId ? 'selected' : ''}`} onClick={() => setSelectedEntryId(entry.portfolioEntryId)} data-testid={`button-select-student-${entry.portfolioEntryId}`}><span>{entry.studentName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><div><b>{entry.studentName}</b><small>{entry.activityTitle}</small></div><ChevronRight size={14} /></button>)}</>}
              <div className="ev-student-summary"><small>{isStudent ? 'TU ACTIVIDAD' : 'EVIDENCIAS SELECCIONADAS'}</small><b>{selectedEntry ? isStudent ? 'Mi evaluación' : selectedEntry.studentName : 'Sin selección'}</b><span>{selectedEntry?.assessments.length ?? 0} intentos documentados</span></div></aside>
              <div className="ev-student-results">{selectedEntry ? <>
                <header className="ev-student-result-head"><div><span className="ev-overline">EVIDENCIA ATRIBUIDA</span><h3>{selectedEntry.activityTitle}</h3><p>{selectedEntry.evidenceDocumentReference || 'Referencia de evidencia'} · {statusLabel[selectedEntry.entryStatus] ?? selectedEntry.entryStatus}</p></div>{canEvaluate && selectedEntry.entryStatus !== 'closed' && <button className="ev-button primary" onClick={() => openAssessment(selectedEntry)} disabled={group?.status === 'closed'} data-testid="button-assess-selected"><Plus size={14} /> Valorar criterio</button>}</header>
                {criteria.length ? <div className="ev-result-criteria">{criteria.map((criterion) => {
                  const attempts = sortedAssessments(selectedEntry.assessments.filter((assessment) => assessment.criterionId === criterion.id));
                  const latest = attempts.at(-1);
                  return <article key={criterion.id} data-testid={`card-student-criterion-${criterion.id}`}><div className="ev-result-criterion-head"><span><small>{criterion.learningOutcomeCode} · {criterion.code}</small><b>{criterion.title}</b></span><span className="ev-score">{displayScore(latest)}</span></div>
                    <div className="ev-result-meta"><span>Peso {criterion.weight}%</span><span>Umbral {criterion.minimumScore}</span><span>{attempts.length} intento(s)</span>{latest && <Status value={latest.status} />}</div>
                    {attempts.length ? <div className="ev-attempt-list">{attempts.map((assessment) => <div key={assessment.id}><span className="ev-attempt-number">Intento {assessment.attemptNumber}{assessment.attemptNumber > 1 ? ' · Recuperación' : ''}</span><b>{assessment.rubricLevelLabel} · {displayScore(assessment)}</b><p>{assessment.feedback}</p><small>{assessment.evaluatorName} · {dateLabel(assessment.createdAt)}</small></div>)}</div> : <p className="ev-unassessed">Pendiente de valoración. Se requieren {criterion.minimumEvidenceCount} evidencia(s).</p>}
                    {canEvaluate && latest?.status === 'recovery_required' && <button className="ev-button recovery" onClick={() => openAssessment(selectedEntry, criterion.id, true)} disabled={group?.status === 'closed'} data-testid={`button-recovery-${criterion.id}`}><RotateCcw size={13} /> Registrar nuevo intento de este criterio</button>}
                  </article>;
                })}</div> : <Empty title="Sin criterios asociados" detail="Configura el mapa RA–criterios para poder registrar resultados." />}
              </> : <Empty title="Selecciona una ficha" detail="El resultado por criterio y el historial de intentos se mostrarán aquí." />}</div>
            </div> : <Empty title="Sin resultados individuales" detail="No hay evidencias evaluadas disponibles para este grupo y perfil." />}
        </section>}

        {view === 'reports' && <section className="ev-panel ev-report-panel"><SectionHead overline="DOCUMENTO DIDÁCTICO" title="Informes y exportación" detail={isManager ? 'Resumen agregado sin nombres ni puntuaciones individuales.' : 'Exporta los datos de evaluación disponibles en tu ámbito.'} action={<div className="ev-report-actions"><button className="ev-button quiet" onClick={exportCsv} data-testid="button-export-csv"><Download size={14} /> Exportar CSV</button><button className="ev-button primary" onClick={printReport} data-testid="button-print-report"><Printer size={14} /> Imprimir / PDF</button></div>} />
          <div className="ev-report-banner"><span className="ev-report-seal"><FileText size={18} /></span><div><b>Informe de evaluación · {campaign?.title}</b><small>Actualizado con registros persistidos · {dateLabel(new Date().toISOString())}</small></div><span className="ev-report-seal-text">USO<br />DIDÁCTICO</span></div>
          <div className="ev-report-kpis"><article><small>Evidencias</small><b>{entries.length}</b></article><article><small>Intentos</small><b>{assessmentsTotal}</b></article><article><small>Criterios alcanzados</small><b>{achievedCount}</b></article><article><small>En recuperación</small><b>{recoveryCount}</b></article></div>
          {isManager ? <div className="ev-manager-summary compact"><p><LockKeyhole size={14} /> El informe agregado no incluye nombres, puntuaciones ni comentarios individuales.</p></div> :
            reportRows.length ? <div className="ev-table-scroll"><table className="ev-data-table ev-report-table"><thead><tr><th>Estudiante</th><th>Actividad</th><th>Criterio</th><th>Intento</th><th>Resultado</th><th>Fecha</th></tr></thead><tbody>{reportRows.map(({ entry, assessment }) => <tr key={assessment.id}><td>{entry.studentName}</td><td>{entry.activityTitle}</td><td>{assessment.criterionTitle}</td><td>{assessment.attemptNumber}</td><td>{displayScore(assessment)} · {assessment.rubricLevelLabel}</td><td>{dateLabel(assessment.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="Aún no hay valoraciones" detail="El informe se generará cuando existan intentos guardados en la evaluación." />}
          <div className="ev-report-disclaimer"><ShieldCheck size={14} /> CSV y PDF son informes didácticos locales. No se envían a ningún LMS y no constituyen una calificación oficial.</div>
        </section>}

        {view === 'audit' && <section className="ev-panel"><SectionHead overline="REGISTRO APPEND-ONLY" title="Auditoría de evaluación" detail={isManager ? 'Consulta únicamente el volumen de actividad; sin nombres ni puntuaciones.' : 'Cambios, valoraciones y motivos quedan conservados sin edición silenciosa.'} />
          {!canViewAudit || isStudent ? <Empty title="Auditoría restringida" detail="El historial detallado está disponible para perfiles autorizados de supervisión." /> :
            isManager ? <div className="ev-audit-summary"><article><small>Eventos registrados</small><b>{audit.length}</b></article>{[...new Set(audit.map((item) => item.action))].map((action) => <article key={action}><small>{action.replaceAll('_', ' ')}</small><b>{audit.filter((item) => item.action === action).length}</b></article>)}<p><LockKeyhole size={14} /> El resumen agregado no muestra actor, registro individual ni puntuación.</p></div> :
              audit.length ? <div className="ev-audit-list">{audit.map((item) => <article key={item.id} data-testid={`row-evaluation-audit-${item.id}`}><span className="ev-audit-mark"><History size={14} /></span><div><small>{item.entityType} · {dateLabel(item.createdAt)}</small><b>{item.summary}</b><p>{item.reason || 'Sin motivo adicional'}</p><span>{item.actorName} · {item.action}</span></div><span className="ev-audit-id">{item.entityId.slice(0, 8)}</span></article>)}</div> :
                <Empty title="Aún no hay eventos auditables" detail="Los cambios confirmados por la API aparecerán aquí en orden cronológico." />}
        </section>}
      </>}
    </>}

    {modal === 'criterion' && <div className="ev-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="ev-modal" role="dialog" aria-modal="true" aria-labelledby="ev-criterion-title">
      <header><div><small>MAPA CURRICULAR VERSIONADO</small><h2 id="ev-criterion-title">{selectedCriterionId ? 'Crear nueva versión' : 'Añadir criterio'}</h2></div><button className="ev-close" onClick={() => setModal(null)} aria-label="Cerrar" data-testid="button-close-criterion-modal"><X size={17} /></button></header>
      <Form {...(selectedCriterionId ? reviseForm : criterionForm)}><form className="ev-form" onSubmit={selectedCriterionId ? saveRevision : addCriterion} data-testid="form-evaluation-criterion">
        <div className="ev-form-grid"><label className="ev-field"><span>Código RA</span><input {...(selectedCriterionId ? reviseForm : criterionForm).register('learningOutcomeCode', { required: true, maxLength: 40 })} placeholder="RA 2" data-testid="input-learning-outcome-code" /></label>
          <label className="ev-field"><span>Resultado de aprendizaje</span><input {...(selectedCriterionId ? reviseForm : criterionForm).register('learningOutcomeTitle', { required: true, minLength: 2, maxLength: 160 })} placeholder="Gestiona operaciones comerciales" data-testid="input-learning-outcome-title" /></label>
          <label className="ev-field"><span>Código CE</span><input {...(selectedCriterionId ? reviseForm : criterionForm).register('code', { required: true, maxLength: 40 })} placeholder="CE 2.1" data-testid="input-evaluation-criterion-code" /></label>
          <label className="ev-field"><span>Criterio de evaluación</span><input {...(selectedCriterionId ? reviseForm : criterionForm).register('title', { required: true, minLength: 2, maxLength: 160 })} placeholder="Formaliza correctamente la operación" data-testid="input-evaluation-criterion-title" /></label>
          <label className="ev-field"><span>Peso (%)</span><input type="number" min="0" max="100" step="0.01" {...(selectedCriterionId ? reviseForm : criterionForm).register('weight', { required: true, valueAsNumber: true, min: 0, max: 100 })} data-testid="input-criterion-weight" /></label>
          <label className="ev-field"><span>Umbral mínimo</span><input type="number" min="0" max="100" {...(selectedCriterionId ? reviseForm : criterionForm).register('minimumScore', { required: true, valueAsNumber: true, min: 0, max: 100 })} data-testid="input-criterion-minimum-score" /></label>
          <label className="ev-field"><span>Evidencias mínimas</span><input type="number" min="1" max="50" {...(selectedCriterionId ? reviseForm : criterionForm).register('minimumEvidenceCount', { required: true, valueAsNumber: true, min: 1, max: 50 })} data-testid="input-criterion-evidence-count" /></label></div>
        <div className="ev-form-footer"><span>La edición genera una versión nueva; no borra el historial.</span><div><button type="button" className="ev-button quiet" onClick={() => { setModal(null); setSelectedCriterionId(''); }} data-testid="button-cancel-criterion">Cancelar</button><button className="ev-button primary" disabled={createCriterion.isPending || reviseCriterion.isPending} data-testid="button-save-criterion">{createCriterion.isPending || reviseCriterion.isPending ? 'Guardando…' : 'Guardar versión'}</button></div></div>
      </form></Form>
    </section></div>}

    {modal === 'rubric' && <div className="ev-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="ev-modal ev-modal-wide" role="dialog" aria-modal="true" aria-labelledby="ev-rubric-title">
      <header><div><small>INSTRUMENTO DE VALORACIÓN</small><h2 id="ev-rubric-title">Crear borrador de rúbrica</h2></div><button className="ev-close" onClick={() => setModal(null)} aria-label="Cerrar" data-testid="button-close-rubric-modal"><X size={17} /></button></header>
      <Form {...rubricForm}><form className="ev-form" onSubmit={saveRubric} data-testid="form-create-rubric">
        <label className="ev-field"><span>Criterio asociado</span><select {...rubricForm.register('criterionId', { required: true })} data-testid="select-rubric-criterion">{criteria.map((criterion) => <option key={criterion.id} value={criterion.id}>{criterion.code} · {criterion.title}</option>)}</select></label>
        <label className="ev-field"><span>Nombre de la rúbrica</span><input {...rubricForm.register('title', { required: true, minLength: 2, maxLength: 120 })} placeholder="Rúbrica de gestión documental" data-testid="input-rubric-title" /></label>
        <div className="ev-rubric-level-editor"><h3>Descriptores observables</h3>{[1, 2, 3, 4].map((n) => <fieldset key={n}><legend>Nivel {n}</legend><label className="ev-field"><span>Nombre</span><input {...rubricForm.register(`level${n}Label` as keyof RubricFormValues, { required: true, maxLength: 80 })} data-testid={`input-rubric-level-${n}-label`} /></label><label className="ev-field"><span>Valor sobre 100</span><input type="number" min="0" max="100" {...rubricForm.register(`level${n}Score` as keyof RubricFormValues, { required: true, valueAsNumber: true, min: 0, max: 100 })} data-testid={`input-rubric-level-${n}-score`} /></label><label className="ev-field"><span>Descriptor</span><textarea rows={2} {...rubricForm.register(`level${n}Descriptor` as keyof RubricFormValues, { required: true, minLength: 1, maxLength: 500 })} data-testid={`textarea-rubric-level-${n}-descriptor`} /></label></fieldset>)}</div>
        <div className="ev-freeze-note"><LockKeyhole size={14} /> Guardar crea un borrador. Solo la publicación fija una versión para evaluación.</div>
        <div className="ev-form-footer"><span>No se asignan puntuaciones automáticas.</span><div><button type="button" className="ev-button quiet" onClick={() => setModal(null)} data-testid="button-cancel-rubric">Cancelar</button><button className="ev-button primary" disabled={createRubric.isPending} data-testid="button-save-rubric">{createRubric.isPending ? 'Guardando…' : 'Guardar borrador'}</button></div></div>
      </form></Form>
    </section></div>}

    {modal === 'assessment' && selectedEntry && <div className="ev-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="ev-modal" role="dialog" aria-modal="true" aria-labelledby="ev-assessment-title">
      <header><div><small>{currentAssessment?.status === 'recovery_required' ? 'RECUPERACIÓN · NUEVO INTENTO' : 'VALORACIÓN DOCENTE'}</small><h2 id="ev-assessment-title">{selectedEntry.activityTitle}</h2></div><button className="ev-close" onClick={() => setModal(null)} aria-label="Cerrar" data-testid="button-close-assessment"><X size={17} /></button></header>
      <div className="ev-assessment-context"><b>{selectedEntry.studentName}</b><span>{selectedCriterion?.code} · {selectedCriterion?.title}</span><small>{selectedEntry.evidenceDocumentReference || 'Evidencia vinculada al portafolio'}</small></div>
      <Form {...assessmentForm}><form className="ev-form" onSubmit={assess} data-testid="form-evaluation-assessment">
        <label className="ev-field"><span>Rúbrica publicada</span><select {...assessmentForm.register('rubricId', { required: true, onChange: (event) => setSelectedRubricId(event.target.value) })} data-testid="select-assessment-rubric"><option value="">Seleccionar rúbrica</option>{assessmentRubricOptions.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}</select></label>
        <fieldset className="ev-level-choice"><legend>Descriptor alcanzado</legend>{selectedRubric?.levels.map((level) => <label key={level.id} className="ev-level-option"><input type="radio" value={level.id} {...assessmentForm.register('rubricLevelId', { required: true })} data-testid={`radio-rubric-level-${level.id}`} /><span><b>{level.label}</b><small>{level.score} / 100 · {level.descriptor}</small></span></label>)}</fieldset>
        <label className="ev-field"><span>Comentario formativo</span><textarea rows={3} {...assessmentForm.register('feedback', { required: true, minLength: 5, maxLength: 1000 })} placeholder="Justifica la valoración con referencia a la evidencia." data-testid="textarea-assessment-feedback" /></label>
        <label className="ev-field"><span>Motivo o fundamento</span><textarea rows={2} {...assessmentForm.register('reason', { required: true, minLength: 5, maxLength: 500 })} placeholder="Criterio observado y decisión docente." data-testid="textarea-assessment-reason" /></label>
        {currentAssessment?.status === 'recovery_required' && <div className="ev-recovery-info"><RotateCcw size={14} /> Se añadirá como un nuevo intento de recuperación de este criterio. El intento previo permanece intacto.</div>}
        <div className="ev-form-footer"><span>Escala configurada: {scoreScale} puntos · Solo rúbricas publicadas</span><div><button type="button" className="ev-button quiet" onClick={() => setModal(null)} data-testid="button-cancel-assessment">Cancelar</button><button className="ev-button primary" disabled={createAssessment.isPending || !assessmentRubricOptions.length} data-testid="button-save-assessment">{createAssessment.isPending ? 'Guardando…' : 'Registrar valoración'}</button></div></div>
      </form></Form>
    </section></div>}

    {modal === 'close' && <div className="ev-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="ev-modal ev-close-modal" role="dialog" aria-modal="true" aria-labelledby="ev-close-title">
      <header><div><small>CIERRE DIDÁCTICO IRREVERSIBLE</small><h2 id="ev-close-title">Cerrar evaluación del grupo</h2></div><button className="ev-close" onClick={() => setModal(null)} aria-label="Cerrar" data-testid="button-dismiss-close-modal"><X size={17} /></button></header>
      <p>El cierre quedará registrado con el motivo indicado. No crea un acta oficial, no publica notas y no se puede deshacer desde esta pantalla.</p>
      <Form {...closeForm}><form className="ev-form" onSubmit={closeGroupSubmit} data-testid="form-close-evaluation">
        <label className="ev-field"><span>Escribe exactamente: <b>{closePhrase}</b></span><input autoComplete="off" {...closeForm.register('confirmationPhrase', { required: true, validate: (value) => value === closePhrase })} data-testid="input-close-confirmation" /></label>
        {closeForm.formState.errors.confirmationPhrase && <small className="ev-validation-error">La frase debe coincidir exactamente.</small>}
        <label className="ev-field"><span>Motivo de cierre</span><textarea rows={3} {...closeForm.register('reason', { required: true, minLength: 10, maxLength: 500 })} placeholder="Justifica el cierre del registro didáctico." data-testid="textarea-close-reason" /></label>
        {closeForm.formState.errors.reason && <small className="ev-validation-error">Escribe un motivo de al menos 10 caracteres.</small>}
        <div className="ev-close-disclaimer"><AlertCircle size={15} /> Cierre de expediente formativo. No es una resolución administrativa ni una calificación oficial.</div>
        <div className="ev-form-footer"><span>Operación confirmada por servidor</span><div><button type="button" className="ev-button quiet" onClick={() => setModal(null)} data-testid="button-cancel-close">Cancelar</button><button className="ev-button danger" disabled={closeGroup.isPending || closeForm.watch('confirmationPhrase') !== closePhrase || (closeForm.watch('reason')?.trim().length ?? 0) < 10} data-testid="button-confirm-close">{closeGroup.isPending ? 'Cerrando…' : 'Confirmar cierre'}</button></div></div>
      </form></Form>
    </section></div>}
  </main>;
}
