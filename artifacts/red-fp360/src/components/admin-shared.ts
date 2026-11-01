import type { AccessRole } from '@workspace/api-client-react';

export const ROLE_OPTIONS: { value: AccessRole; label: string }[] = [
  { value: 'student', label: 'Alumnado' },
  { value: 'team_manager', label: 'Responsable de equipo' },
  { value: 'teacher', label: 'Profesorado' },
  { value: 'promoter', label: 'Promotor/a' },
  { value: 'mentor', label: 'Mentor/a' },
  { value: 'administrator', label: 'Administración' },
];

export function accessRoleLabel(role?: string) {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role ?? '—';
}

export function httpStatus(error: unknown) {
  if (error && typeof error === 'object' && 'status' in error) return Number((error as { status: unknown }).status);
  return 0;
}

export function dateTime(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
