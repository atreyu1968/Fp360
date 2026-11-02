# RED FP360

ERP educativo para centros de Formación Profesional de Canarias. Las empresas, operaciones, cuentas y trámites son simulados; la aplicación no presenta declaraciones oficiales ni ejecuta pagos o actuaciones reales.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API de desarrollo (puerto `PORT`, en este workspace 8080)
- `pnpm run typecheck` — comprobación de tipos de todos los paquetes
- `pnpm run build` — tipos y builds de los paquetes
- `pnpm --filter @workspace/api-spec run codegen` — cliente y validadores desde OpenAPI
- `pnpm run test:api` — pruebas de rutas
- `pnpm run test:db-integration` — pruebas HTTP con PostgreSQL de desarrollo y API en 8080
- `pnpm --filter @workspace/db run push` — solo esquema de desarrollo/prueba desechable; nunca producción
- Requeridos por el API: `DATABASE_URL`, `SESSION_SECRET`, `PORT`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod 4, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/red-fp360/` — aplicación web.
- `artifacts/api-server/` — API Express y permisos de servidor.
- `lib/api-spec/openapi.yaml` — contrato HTTP de origen.
- `lib/api-zod/` y `lib/api-client-react/` — archivos generados; regenera con Orval, no edites a mano.
- `lib/db/src/schema/` — esquema PostgreSQL Drizzle.
- `README.md` — manual de desarrollo, pruebas y preparación de producción.

## Architecture decisions

- La autenticación es propia de RED FP360; no usar Clerk.
- Los cambios de negocio son simulaciones educativas, auditables y acotadas al tenant y empresa autorizados.
- El coordinador IA usa el estado de red y el historial de operaciones; el endpoint local es la opción predeterminada y GroqCloud es externo y optativo, con confirmación del administrador. La clave vive en Secretos, nunca en la base de datos.
- La fiscalidad debe separar obligaciones estatales AEAT de las canarias ATC; el uso de modelos oficiales es didáctico, no una presentación real.
- La producción con PostgreSQL administrado por Replit recibe cambios de esquema mediante el diff de Publish. Nunca ejecutar `push` desde despliegue o contra producción.

## Product

Incluye gestión académica y documental, empresas simuladas, operaciones comerciales, contabilidad didáctica, fiscalidad educativa, evaluaciones y coordinación económica entre centros.

## User preferences

Mantener el límite educativo y simulado. La IA podrá tener autonomía simulada solo para una empresa que active expresamente la administración y con revocación y auditoría; esa función se está desarrollando.

## Gotchas

- Mantener `app.set("trust proxy", 1)` antes de los límites de acceso; el proxy de Replit necesita exactamente un salto de confianza.
- Para pruebas HTTP, arrancar el API y mantener la base en desarrollo. No ejecutar `test:db-integration` con `NODE_ENV=production`.
- Tras una actualización mayor que cambie tipos públicos, ejecutar `pnpm exec tsc --build --force` una vez antes del chequeo incremental normal.
- Para cambios en PostgreSQL administrado por Replit, revisar el diff de Publish y sus confirmaciones de renombre; no crear DDL en el arranque ni migraciones de producción propias.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
