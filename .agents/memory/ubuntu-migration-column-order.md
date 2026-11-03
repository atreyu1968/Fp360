---
name: Orden de columnas en migraciones Ubuntu
description: Mantener snapshots Drizzle compatibles con migraciones aditivas PostgreSQL del actualizador Ubuntu.
---

Cuando una migración Ubuntu agrega una columna con `ALTER TABLE ... ADD COLUMN`, declara el campo nuevo al final del objeto de tabla Drizzle para que el snapshot conserve el orden físico que PostgreSQL crea.

**Why:** La comprobación del esquema compara el catálogo incluyendo la posición ordinal de las columnas; un campo insertado en medio puede tener el mismo tipo y nombre, pero el snapshot deja de coincidir con el resultado de la migración.

**How to apply:** En cambios compatibles que agregan columnas, añade el campo al final de la definición de tabla y ejecuta la prueba del historial de migraciones antes de actualizar su snapshot y manifiesto.
