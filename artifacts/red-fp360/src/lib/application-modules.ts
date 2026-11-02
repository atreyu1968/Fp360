export const applicationModules = [
  { id: 1, name: 'Dirección y cuadro de mando', href: '/' },
  { id: 2, name: 'CRM y contactos', href: '/crm' },
  { id: 3, name: 'Ventas y facturación', href: '/ventas' },
  { id: 4, name: 'Compras y aprovisionamiento', href: '/compras' },
  { id: 5, name: 'Productos y servicios', href: '/productos' },
  { id: 6, name: 'Almacén e inventario', href: '/almacen' },
  { id: 7, name: 'Logística y distribución', href: '/logistica' },
  { id: 8, name: 'Contabilidad', href: '/contabilidad' },
  { id: 9, name: 'Tesorería', href: '/tesoreria' },
  { id: 10, name: 'Recursos humanos', href: '/recursos-humanos' },
  { id: 11, name: 'Nóminas', href: '/nominas' },
  { id: 12, name: 'Atención al cliente', href: '/atencion-cliente' },
  { id: 13, name: 'Proyectos y servicios', href: '/proyectos-servicios' },
  { id: 14, name: 'Gestión documental', href: '/gestion-documental' },
  { id: 15, name: 'Mercado FP360', href: '/mercado' },
  { id: 16, name: 'Banco FP360', href: '/banco' },
  { id: 17, name: 'Hacienda FP360', href: '/hacienda' },
  { id: 18, name: 'Seguridad Social FP360', href: '/seguridad-social' },
  { id: 19, name: 'Empleo FP360', href: '/empleo' },
  { id: 20, name: 'Centro de comunicaciones', href: '/comunicaciones' },
  { id: 21, name: 'FP360 SIM — Dirección inteligente', href: '/simulaciones' },
  { id: 22, name: 'Portafolio profesional', href: '/portafolio' },
  { id: 23, name: 'Evaluación docente', href: '/evaluacion-docente' },
  { id: 24, name: 'Mentoría empresarial', href: '/mentoria-empresarial' },
  { id: 25, name: 'Coordinación intercentros', href: '/coordinacion-intercentros' },
  { id: 26, name: 'Administración del sistema', href: '/administracion', administratorOnly: true },
] as const;

export function canOpenApplication(module: { id: number; administratorOnly?: boolean }, role: string) {
  return !module.administratorOnly || role === 'administrator';
}
