import { type ReactNode, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, X } from 'lucide-react';
import {
  getGetFp360DashboardQueryKey, getListFp360ActivityQueryKey, getListFp360OrdersQueryKey,
  getListFp360OrganizationsQueryKey, getListFp360ProductsQueryKey,
} from '@workspace/api-client-react';

export const WRITE_ROLES = ['student', 'team_manager', 'teacher', 'administrator'];
export const PUBLISH_ROLES = ['teacher', 'administrator'];
export const ISLANDS = ['Tenerife', 'Gran Canaria', 'Lanzarote', 'Fuerteventura', 'La Palma', 'La Gomera', 'El Hierro', 'La Graciosa'] as const;

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const e = error as { status?: number; data?: unknown };
    const d = e.data as Record<string, unknown> | undefined;
    const msg = d && typeof d === 'object' ? (typeof d.error === 'string' ? d.error : typeof d.message === 'string' ? d.message : '') : '';
    if (msg) return msg;
    if (e.status === 403) return 'Tu perfil no tiene permiso para esta acción.';
    if (e.status === 409) return 'La operación entra en conflicto con datos existentes.';
    if (e.status === 400 || e.status === 422) return 'Los datos no son válidos. Revísalos.';
    if (e.status === 404) return 'El registro ya no existe. Actualiza la lista.';
  }
  return fallback;
}

export function eurosToCents(value: string): number | null {
  const v = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const [i, f = ''] = v.split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return cents <= 100000000 ? cents : null;
}
export function percentToBasis(value: string): number | null {
  const v = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const bp = Math.round(Number(v) * 100);
  return bp <= 10000 ? bp : null;
}
export const centsToEuros = (c: number) => (c / 100).toFixed(2);
export const basisToPercent = (b: number) => String(b / 100);

export function useRefreshMaster() {
  const qc = useQueryClient();
  return (extra: readonly unknown[][] = []) => {
    for (const key of [getListFp360ProductsQueryKey(), getListFp360OrganizationsQueryKey(), getListFp360OrdersQueryKey(), getGetFp360DashboardQueryKey(), getListFp360ActivityQueryKey(), ...extra]) {
      void qc.invalidateQueries({ queryKey: key as unknown[] });
    }
  };
}

export function MasterDialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={wide ? 'modal md-wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby="md-title">
      <div className="modal-head"><h2 id="md-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar" data-testid="button-close-dialog"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}

export function ReadOnlyBanner({ text }: { text: string }) {
  return <div className="md-readonly" role="status" data-testid="status-readonly"><ShieldAlert size={15} /><span>{text}</span></div>;
}

export function FormError({ text }: { text: string }) {
  if (!text) return null;
  return <div className="auth-error" role="alert"><ShieldAlert size={16} /><span>{text}</span></div>;
}
