import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './_group.css';

const organizations = [
  { id: 'atlantic', name: 'Atlántico Distribuciones', center: 'IES Atlántico Norte' },
  { id: 'la-laguna', name: 'Servicios La Laguna', center: 'CIFP La Laguna' },
];

export function Current() {
  const [organizationId, setOrganizationId] = useState(organizations[0].id);

  return (
    <main className="active-environment-stage">
      <section className="sidebar-context" aria-label="Selector de entorno actual">
        <span className="context-label">ENTORNO ACTIVO</span>
        <div className="context-selector">
          <span className="context-avatar">AD</span>
          <span className="context-choice">
            <b>Empresa activa</b>
            <select
              aria-label="Empresa activa"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.center}
                </option>
              ))}
            </select>
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
