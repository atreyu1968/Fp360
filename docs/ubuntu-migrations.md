# Migraciones desatendidas de PostgreSQL en Ubuntu

## Alcance y seguridad

Este procedimiento corresponde exclusivamente al PostgreSQL local `redfp360`
del servidor Ubuntu instalado por `scripts/install-ubuntu.sh`. No migra bases
gestionadas por Replit, no se ejecuta al arrancar la API y no forma parte del
build. La herramienta de aplicación exige el indicador `ubuntu-local` y una
conexión de bucle local al puerto PostgreSQL 5432 y a la base `redfp360`.
El actualizador proporciona ese indicador; no deben añadirse hooks de
migración a la publicación de Replit.

No hace falta contestar preguntas durante una instalación o actualización:
el administrador configura previamente el dominio, entorno y copias. La
preparación y revisión de las migraciones se realiza al desarrollar una
publicación, no durante su instalación en el servidor.

## Qué ocurre al instalar o actualizar

1. En una instalación nueva se verifica que la base está completamente vacía.
   El snapshot inicial y las migraciones siguientes se aplican en una sola
   transacción. Se rechaza reinicializar una base con datos o con historial.
2. Para actualizar se descarga y compila el código, y se verifica el manifiesto
   sin cambiar la base. Una modificación de los archivos del esquema sin
   historial revisado impide continuar.
3. Se realiza la copia cifrada coordinada de PostgreSQL y documentos, se toma
   el bloqueo compartido de mantenimiento y se detiene la API.
4. Se abre una transacción y un bloqueo asesor de PostgreSQL. Se rechaza una
   segunda migración simultánea. Los bloqueos de tablas tienen un límite de
   cinco segundos; cada sentencia tiene un límite de sesenta segundos.
5. En la primera adopción de una instalación anterior, se compara el esquema
   existente con el snapshot inicial. No se vuelve a crear sobre las tablas
   existentes. Cualquier discrepancia impide adoptarlo automáticamente.
6. Se verifican los checksums y el historial ya aplicado, y se compara el
   catálogo actual con la huella guardada. Se ejecutan solo las migraciones
   pendientes y se compara cada resultado con su snapshot revisado.
7. Se confirma la transacción solo si todo coincide. El historial queda en
   `redfp360_migrations.history`, incluido en las copias completas de la base.
8. Se activa el código nuevo y se comprueba la salud. Si una migración falla,
   toda su transacción se revierte y se reactiva la API anterior. Si falla el
   código nuevo después de confirmar una migración, se restaura el código
   anterior, pero se conserva el esquema ampliado y cualquier dato.

La comprobación del catálogo utiliza esquemas auxiliares de nombre aleatorio,
sin datos de empresas. Se crean, inspeccionan y eliminan dentro de la misma
transacción. El usuario de la base necesita permiso para crear esquemas; el
instalador lo configura como propietario de su base local.

## Cambios que se pueden automatizar

- Tablas nuevas.
- Índices no únicos nuevos.
- Tipos nuevos.
- Restricciones declaradas dentro de tablas nuevas y vacías.
- Columnas opcionales nuevas, sin `DEFAULT`, `NOT NULL`, claves o restricciones sobre
  los datos existentes.
- Transiciones sin SQL para cambios de organización del código del esquema,
  siempre con snapshot e historial explícitos.

Las sentencias se envían individualmente por el protocolo extendido de
PostgreSQL: no se admite esconder varias instrucciones o un `COMMIT` en una
misma sentencia. Una política conservadora rechaza SQL destructivo,
modificaciones de datos, renombrados, índices concurrentes y otras operaciones
incompatibles. Esta política **no es un sandbox para código SQL no fiable**:
las migraciones y snapshots son código de la publicación y requieren revisión.
No debe aceptarse código de una fuente no confiable.

Eliminar columnas o tablas, convertir tipos, añadir restricciones a datos
existentes o hacer backfills requiere un procedimiento específico y revisado.
El actualizador no improvisa esos cambios ni ejecuta `push --force`.

La migración `0006_organization_economic_networks` es una excepción de backfill
revisada y documentada: después de aplicar su DDL, el actualizador ejecuta
`lib/db/scripts/backfill-organization-scopes.mjs` dentro de una transacción
independiente. Solo crea los centros, una red ordinaria por tenant y las
asignaciones que falten. Empresas de distintos centros del mismo tenant
comparten esa red para conservar las relaciones económicas existentes. No
cambia empresas, movimientos, facturas, saldos ni historial. El proceso es
idempotente y está restringido al PostgreSQL local de Ubuntu; si falla, el
actualizador no activa el código nuevo y se puede reintentar sin duplicar
asignaciones.

## Preparar una publicación que cambie el esquema

El historial se encuentra en `lib/db/migrations/manifest.json`:

- `states`: estados del código del esquema, en orden, con `schemaHash`,
  snapshot SQL de Drizzle y su checksum SHA-256.
- `migrations`: una transición entre cada par de estados consecutivos. Cada
  transición identifica un archivo JSON con un array de sentencias SQL,
  su checksum y la declaración revisada `backwardsCompatible: true`.

Ejemplo del contenido de un archivo de transición:

```json
[
  "ALTER TABLE fp360_organizations ADD COLUMN educational_note text;"
]
```

Es un ejemplo, **no una migración que deba aplicarse a la aplicación actual**.

Para preparar una publicación:

1. Modificar el esquema TypeScript y escribir únicamente las ampliaciones
   necesarias en un nuevo JSON. No modificar ni eliminar transiciones antiguas.
2. Exportar el esquema final mediante
   `pnpm --filter @workspace/db exec drizzle-kit export --dialect postgresql --schema ./src/schema/index.ts`.
   Guardar la salida SQL en un snapshot nuevo, sin cambiar los anteriores.
3. Obtener el hash del código con `schemaSourceHash` de
   `lib/db/scripts/ubuntu-migration-plan.mjs`. Esta función incluye los nombres
   y contenidos del directorio `src/schema` y `drizzle.config.ts`; no incluye
   credenciales. Obtener el SHA-256 de los nuevos archivos.
4. Añadir el estado y la transición al manifiesto. Los identificadores tienen
   formato `0001_descripcion`; las rutas son nombres de archivos dentro del
   directorio de migraciones. Una transición necesita revisión explícita de
   compatibilidad con la versión anterior. Los snapshots y migraciones
   previamente aplicados son inmutables.
5. Ejecutar `pnpm --filter @workspace/db run migrations:plan` y
   `pnpm --filter @workspace/db run test:ubuntu-migrations` en desarrollo.
   La prueba comprueba que el último snapshot coincide exactamente con la
   exportación actual de Drizzle. Probar también cada publicación real sobre
   una copia autorizada del esquema y datos de la versión anterior.
6. Publicar el código y sus archivos de migración juntos en GitHub.

El servidor solo necesita el comando habitual:

```bash
sudo /opt/redfp360/scripts/update-ubuntu.sh --ref main
```

La primera versión de este historial describe el esquema actual; no añade
campos de negocio ni aplica cambios ficticios a las empresas.

## Recuperación y límites

- Un reintento verifica el historial y no repite migraciones confirmadas.
- Si el código anterior sigue activo tras un fallo de despliegue, puede
  continuar con el esquema ampliado. Una nueva actualización reconoce las
  migraciones confirmadas aunque el código anterior no las contenga.
- Se rechazan versiones que no incluyen el historial ya aplicado. La
  reversión de código del propio actualizador no equivale a una migración
  descendente de la base.
- No se restaura automáticamente una copia antigua de la base: hacerlo
  podría borrar operaciones posteriores. Para una recuperación completa,
  seguir [el procedimiento de copias](ubuntu-backups.md), incluyendo el código
  compatible con la copia elegida.
- Un corte de alimentación o `SIGKILL` no puede ser atendido por un trap de
  Bash. PostgreSQL conserva la atomicidad de la transacción; antes de reintentar
  debe comprobarse el servicio y la versión de código instalada.
- Las pruebas automatizadas usan esquemas aislados y datos ficticios en
  PostgreSQL y servicios simulados para el actualizador. No sustituyen un
  ensayo de instalación, actualización y recuperación en un Ubuntu real.
