import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './_group.css';

const organizations = [
  { id: 'atlantic', name: 'Atlántico Distribuciones', center: 'IES Atlántico Norte' },
  { id: 'la-laguna', name: 'Servicios La Laguna', center: 'CIFP La Laguna' },
];

export function Improved() {
  const [organizationId, setOrganizationId] = useState(organizations[0].id);
  const activeOrganization = organizations.find((organization) => organization.id === organizationId);

  return (
    <main className="active-environment-stage">
      <section className="sidebar-context" aria-label="Selector de entorno mejorado">
        <span className="context-label">ENTORNO ACTIVO</span>
        <div className="context-selector context-selector-improved">
          <span className="context-avatar" aria-hidden="true">
            {activeOrganization?.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '—'}
          </span>
          <span className="context-choice" aria-live="polite">
            <b>{activeOrganization?.name ?? 'Selecciona una empresa'}</b>
            <small>{activeOrganization?.center ?? 'Abre el selector para elegir'}</small>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
          <select
            className="context-select-overlay"
            aria-label="Cambiar empresa y entorno educativo"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} · {organization.center}
              </option>
            ))}
          </select>
        </div>
      </section>
    </main>
  );
}
