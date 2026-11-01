---
name: Validación tras actualizar dependencias
description: Evitar resultados engañosos del compilador incremental después de actualizar bibliotecas que cambian sus tipos públicos.
---

Después de una actualización mayor de una dependencia con tipos públicos, fuerza una reconstrucción de los proyectos TypeScript compartidos antes de confiar en el chequeo normal.

**Why:** Durante la migración a Zod 4, las declaraciones incrementales conservadas de la versión anterior hicieron que las bibliotecas parecieran compilar y produjeron errores engañosos en consumidores. La reconstrucción forzada reveló las incompatibilidades reales del generador.

**How to apply:** Ejecutar una vez `pnpm exec tsc --build --force` tras ese tipo de actualización, corregir cualquier error en la fuente o configuración del generador y después ejecutar la validación normal. No basta con comprobar los consumidores contra declaraciones antiguas.
