import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAdminAiDelegationsQueryKey, getListAdminAuditQueryKey,
  useListAdminAiDelegations, useUpdateAdminAiDelegation, useRunAdminAiDelegation,
} from '@workspace/api-client-react';
import type { AiDelegation, AiDelegationOperation, AdminSystemOverview } from '@workspace/api-client-react';
import { dateTime } from './admin-shared';

const operationLabels: Record<AiDelegationOperation, string> = {
  create_simulated_document: 'Crear notas y documentos didácticos',
  complete_simulation_event: 'Vincular evidencia confirmada y completar eventos sin requisitos pendientes',
};
const statusLabels: Record<string, string> = {
  running: 'En curso', applied: 'Registrado', cancelled: 'Cancelado sin cambios', failed: 'Fallido sin cambios',
};
type Notice = (text: string, kind: 'success' | 'error') => void;

export function AdminAiDelegations({ data, done }: { data: AdminSystemOverview; done: Notice }) {
  const overview = useListAdminAiDelegations({ query: { refetchInterval: 5000, staleTime: 0 } });
  const [selected, setSelected] = useState('');
  const companyId = selected || data.organizations[0]?.id || '';
  const company = data.organizations.find(o => o.id === companyId);
  const grant = overview.data?.delegations.find(d => d.organizationId === companyId);
  return <section className="ac-panel" aria-label="Delegación de empresas a la IA">
    <header className="ac-panel-head"><div><h3>Autonomía simulada por empresa</h3>
      <p>Sin delegación explícita se mantiene la aprobación humana. Cada ciclo consulta el estado y el historial de toda la red, pero solo modifica su empresa.</p></div></header>
    <div className="ac-ai-form">
      <label className="ac-field"><span>Empresa simulada</span><select value={companyId} onChange={e => setSelected(e.target.value)} data-testid="ai-delegation-company">
        {!data.organizations.length && <option value="">No hay empresas</option>}
        {data.organizations.map(o => <option key={o.id} value={o.id}>{o.name}{!o.isActive ? ' · Suspendida' : ''}</option>)}
      </select></label>
      {overview.isLoading ? <p>Cargando delegaciones…</p> : overview.isError ? <p role="alert">No se pudieron consultar las delegaciones. <button onClick={() => overview.refetch()}>Reintentar</button></p> :
        company && <DelegationControls key={`${companyId}:${grant?.revision ?? 0}`} companyId={companyId}
          active={company.isActive} providerEnabled={data.aiCoordinator.enabled && data.aiCoordinator.provider === 'local'} grant={grant} done={done} />}
      <div className="ac-callout"><p>Ciclos automáticos cada cinco minutos, hasta tres acciones por ciclo. No se ejecutan pagos, trámites fiscales ni acciones laborales reales. Las notas son borradores educativos sin validez real. Los eventos con requisitos previos permanecen bajo control humano. Revocar detiene los ciclos pendientes sin borrar el historial ni los documentos ya creados.</p></div>
      <div className="ac-callout ac-ai-onboarding">
        <div><b>Altas con datos ficticios revisables</b>
          <p>Las propuestas para crear empresas usan la red económica elegida, requieren revisión humana y solo completan la ficha. No heredan estos permisos automáticos ni crean operaciones.</p>
          <small>{data.aiCoordinator.enabled ? `Proveedor supervisado activo: ${data.aiCoordinator.provider === 'groqcloud' ? 'GroqCloud' : 'local'}.` : 'Configura y activa un proveedor en Coordinación IA para generar propuestas.'}</small>
        </div>
        <Link href="/clientes" className="ac-button" data-testid="link-ai-company-onboarding">Ir al directorio</Link>
      </div>
      <h4>Actividad de esta empresa</h4>
      {overview.data?.runs.filter(r => r.organizationId === companyId).slice(0, 10).map(run => <article key={run.id} className="ac-callout">
        <div><b>{statusLabels[run.status] ?? run.status} · revisión {run.revision}</b>
          <p>{dateTime(run.createdAt)} · Actor: {run.serviceActorId}</p>
          <p>Solicitado por: {run.requestedBy}</p>
          {run.snapshotAt && <p>Contexto de red: {dateTime(run.snapshotAt)} · {run.companyCount} empresas · {run.operationCount} operaciones · Modelo: {run.model}</p>}
          {run.contextHash && <details><summary>Huella del contexto consultado</summary><code>{run.contextHash}</code></details>}
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{run.detail}</p>
        </div>
      </article>)}
      {overview.data && !overview.data.runs.some(r => r.organizationId === companyId) && <p>No hay ciclos ni cambios de delegación registrados.</p>}
    </div>
  </section>;
}

function DelegationControls({ companyId, active, providerEnabled, grant, done }: {
  companyId: string; active: boolean; providerEnabled: boolean; grant?: AiDelegation; done: Notice;
}) {
  const qc = useQueryClient();
  const update = useUpdateAdminAiDelegation();
  const run = useRunAdminAiDelegation();
  const [allowed, setAllowed] = useState<AiDelegationOperation[]>(grant?.allowedOperations ?? ['create_simulated_document']);
  const [confirmed, setConfirmed] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListAdminAiDelegationsQueryKey() });
    qc.invalidateQueries({ queryKey: getListAdminAuditQueryKey() });
    // Documents, events and portfolios may be open in another part of this session.
    qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('/redfp360/') });
  };
  const save = (enabled: boolean) => update.mutate({
    organizationId: companyId,
    data: { operationId: crypto.randomUUID(), enabled, allowedOperations: enabled ? allowed : [], expectedRevision: grant?.revision ?? 0 },
  }, {
    onSuccess: () => { refresh(); done(enabled ? 'Delegación activada. La IA actuará solo con los permisos seleccionados.' : 'Control recuperado. Los ciclos pendientes no podrán registrar cambios.', 'success'); },
    onError: () => { refresh(); done('No se pudo cambiar la delegación. Comprueba el estado actualizado y vuelve a intentarlo.', 'error'); },
  });
  return <>
    <p><b>{grant?.enabled ? 'Delegada a la IA' : 'Control humano · aprobación requerida'}</b>
      {grant && <> · Revisión {grant.revision} · {dateTime(grant.updatedAt)}</>}</p>
    {grant?.enabled && <p>Actor de servicio limitado a esta empresa: <code>{grant.serviceActorId}</code></p>}
    <fieldset disabled={update.isPending}><legend>Operaciones simuladas permitidas explícitamente</legend>
      {(Object.keys(operationLabels) as AiDelegationOperation[]).map(operation => <label key={operation} className="ac-ai-toggle">
        <input type="checkbox" checked={allowed.includes(operation)} onChange={e => setAllowed(previous =>
          e.target.checked ? [...previous, operation] : previous.filter(p => p !== operation))} /> {operationLabels[operation]}
      </label>)}
    </fieldset>
    <label className="ac-ai-toggle"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      Autorizo estos cambios automáticos exclusivamente en esta empresa simulada.</label>
    <div className="ac-form-actions">
      <button className="ac-button" data-testid="ai-delegation-enable" disabled={update.isPending || !confirmed || !allowed.length || !active || !providerEnabled}
        onClick={() => save(true)}>{grant?.enabled ? 'Actualizar permisos' : 'Delegar empresa a la IA'}</button>
      {grant?.enabled && <>
        <button className="ac-button" data-testid="ai-delegation-run" disabled={run.isPending || !active || !providerEnabled}
          onClick={() => run.mutate({ organizationId: companyId, data: { operationId: crypto.randomUUID() } }, {
            onSuccess: result => { refresh(); done(result.status === 'applied' ? 'Ciclo registrado. Consulta los documentos y eventos simulados.' : 'Ciclo detenido. Consulta su resultado en la actividad.', result.status === 'applied' ? 'success' : 'error'); },
            onError: () => { refresh(); done('No se pudo iniciar el ciclo. Revisa la delegación y los ciclos en curso.', 'error'); },
          })}>{run.isPending ? 'Consultando IA…' : 'Ejecutar ciclo ahora'}</button>
        <button className="ac-button" data-testid="ai-delegation-revoke" disabled={update.isPending}
          onClick={() => save(false)}>Revocar y recuperar control</button>
      </>}
    </div>
    {!providerEnabled && <p>El proveedor local debe estar seleccionado y activado para delegar o ejecutar. GroqCloud sigue disponible para propuestas supervisadas. La revocación sigue disponible.</p>}
  </>;
}
