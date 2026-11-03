---
name: Validación tras actualizar dependencias
description: Evitar resultados engañosos del compilador incremental después de actualizar bibliotecas que cambian sus tipos públicos.
---

Después de actualizar dependencias con tipos públicos o cambiar contratos/tipos compartidos, reconstruye las declaraciones de los proyectos TypeScript compartidos antes de confiar en el chequeo del artefacto consumidor.

**Why:** Durante la migración a Zod 4 y al actualizar un contrato de API, las declaraciones incrementales conservadas quedaron desfasadas: los consumidores mostraron errores que desaparecieron al reconstruir las bibliotecas compartidas.

**How to apply:** Ejecutar `pnpm run typecheck:libs` después de cambiar tipos compartidos o generar el cliente. Si hubo cambios mayores de dependencias, usar `pnpm exec tsc --build --force`. Después, ejecutar el chequeo normal del artefacto consumidor.
