---
name: Validación tras tipos compartidos y fusiones
description: Reconstruir tipos y detectar cambios solapados tras integrar tareas concurrentes.
---

Después de actualizar dependencias con tipos públicos o cambiar contratos/tipos compartidos, reconstruye las declaraciones de los proyectos TypeScript compartidos antes de confiar en el chequeo del artefacto consumidor.

Tras integrar varias tareas que modifican rutas o pruebas cercanas, revisa los cambios combinados por declaraciones o bloques duplicados antes de considerar válida la integración.

**Why:** En RED FP360, las fusiones paralelas dejaron tipos compartidos desactualizados y duplicaron fragmentos en rutas y pruebas; el estado individual de las tareas no garantizó que la combinación compilara.

**How to apply:** Ejecutar `pnpm run typecheck:libs` tras cambiar tipos compartidos, después el typecheck del API y la suite completa cuando las fusiones toquen rutas o pruebas. Si cambian dependencias mayores, usar `pnpm exec tsc --build --force`.
