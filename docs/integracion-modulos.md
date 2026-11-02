# Comprobación de enlaces e integración de RED FP360

Revisión: 2 de noviembre de 2026.

## Conclusión

Los 26 módulos tienen rutas registradas y están enlazados desde el catálogo.
Administración solo se ofrece como enlace a quienes tienen ese rol; el servidor
mantiene sus comprobaciones de permisos.

Esto no significa que todos los procesos intercambien datos automáticamente.
Hay conexiones funcionales comprobadas y otras integraciones todavía ausentes.
Las etapas financieras y las aprobaciones educativas deben conservarse como
acciones separadas y auditables, no ejecutarse por abrir una pantalla.

## Alcance comprobado

| Comprobación | Resultado y límite |
| --- | --- |
| Navegación en navegador | Se visitaron las 30 rutas del menú con una cuenta temporal administradora. No hubo rutas 404 ni pantallas permanentemente vacías por rutas inexistentes. Se detectaron errores de datos en Hacienda y Proyectos, corregidos posteriormente. |
| Alias | `/apps` abre Aplicaciones; `/docs` abre Documentación. Se comprobó la recarga directa de Documentación. |
| Roles | Un estudiante temporal recibió la denegación esperada en Administración. |
| Catálogo | Se sustituyeron filas sin enlaces por enlaces reales. Se corrigieron el contador fijo de seis aplicaciones y el estado incorrecto de Administración. Se observaron los cambios en caliente; no se completó una recarga autenticada posterior ni un segundo recorrido de las 26 tarjetas. |
| Rutas de módulos | Las pruebas estáticas verifican los 26 destinos, las rutas del menú, sus páginas y los alias. |
| Cliente y API | Se contrastaron estáticamente las 232 operaciones generadas del cliente con métodos y rutas realmente montados en el servidor, incluidos routers anidados. Esto no equivale a ejecutar las 232 operaciones. |
| Integración con PostgreSQL y API | Pasaron las pruebas de Catálogo, Compras, CRM y exportación contable. La prueba de Compras ahora incluye las conexiones con Proyectos y Hacienda. |
| Tipos y arranque | Pasaron los chequeos TypeScript del cliente y servidor. Ambos servicios se reiniciaron correctamente tras sus cambios. |

No se ejecutaron operaciones reales, presentaciones fiscales, pagos ni llamadas
de IA. Las pruebas de API utilizaron empresas y usuarios ficticios aislados,
con limpieza posterior. Las cuentas temporales del navegador también se eliminaron.

## Fallos corregidos

### Catálogo de aplicaciones

- Las filas no tenían enlaces, aunque los módulos existían en el menú.
- El contador anunciaba seis disponibles, sin relación con los módulos reales.
- Administración aparecía como planificada, pese a tener pantalla funcional.

Ahora existe un registro explícito de los 26 destinos, enlaces navegables por
teclado y un contador de acceso según rol. El resto de permisos operativos
continúa aplicándose dentro de cada módulo y en el servidor.

### Compras → Proyectos

La consulta de recepciones usaba una columna de líneas de pedido sin incluir
esa tabla en la consulta, provocando un error SQL y un HTTP 500. Se eliminó
esa condición inválida: la recepción ya queda vinculada al pedido por su JOIN.

La regresión comprueba que el panel de Proyectos carga las recepciones
completadas del comprador y no expone esas referencias a otra empresa.

### Hacienda → contrato de la API

Las consultas obtenían fechas de PostgreSQL como objetos `Date`, mientras que
la respuesta validada exigía cadenas ISO. El error se reproducía con eventos
fiscales existentes. Afectaba también a respuestas de declaraciones y
requerimientos que entregaban filas sin convertir.

Se normalizan las fechas antes de validar las respuestas. La regresión cubre
el perfil fiscal, creación y repetición de un borrador, y consulta del panel
con declaraciones y eventos. No constituye una prueba de cada transición fiscal.
La separación visual entre ATC/Canarias y AEAT/Estatal se observó en navegador.

## Conexiones funcionales y huecos de datos

| Relación | Estado observado |
| --- | --- |
| Catálogo ↔ Almacén ↔ Ventas | Comparten productos y existencias; las pruebas conservan precios históricos y reservas. Hay accesos cruzados visibles. |
| Compras → recepciones → facturas de proveedor | Cubierto por la prueba de aprovisionamiento, con permisos y controles de cantidades. |
| Compras → costes de Proyectos | El panel vuelve a ofrecer las recepciones de la empresa tras corregir la consulta. La aprobación del coste sigue siendo independiente. |
| Pedidos → Logística → Facturas | Hay referencias y controles de entrega en el código y enlaces entre pantallas. No se reprodujo en navegador una operación completa en esta revisión. |
| Facturas/cobros/compras → Contabilidad | La contabilidad recoge fuentes comerciales de forma explícita; una operación comercial no equivale por sí sola a un asiento contabilizado. |
| Facturas de venta y compra → Hacienda | El módulo fiscal consulta documentos comerciales por periodo. La prueba añadió cobertura del panel fiscal con datos y eventos. |
| RR. HH. → Nóminas | Nóminas utiliza empleados e incidencias de RR. HH. Revisión de código, no ciclo laboral completo ejecutado. |
| RR. HH./Nóminas → Seguridad Social | Existe navegación, pero Seguridad Social mantiene trabajadores y liquidaciones propios. No se encontró una vinculación directa con los empleados o ejecuciones de nómina. |
| Nóminas → Contabilidad | No se encontró una fuente contable específica de nóminas. Las fuentes actuales son manuales, facturas comerciales, cobros y reversiones. |
| Nóminas → retenciones fiscales | No se encontró alimentación directa desde nóminas a las declaraciones de retenciones; sus importes se gestionan por separado. |
| Documentos y formación | Las pantallas y API están montadas y cargaron; no se crearon documentos, evidencias, evaluaciones o campañas para probar todo su ciclo. |
| Coordinación e IA | Los accesos existen. No se ejecutó una propuesta o ciclo de IA ni se verificó su efecto económico entre empresas en esta revisión. |

## Comprobaciones reproducibles

```bash
node --test scripts/tests/application*-links.test.mjs
pnpm --filter @workspace/red-fp360 run typecheck
pnpm --filter @workspace/api-server run typecheck
NODE_ENV=test node --test \
  lib/db/tests/catalog.test.mjs \
  lib/db/tests/purchases.test.mjs \
  lib/db/tests/crm.test.mjs \
  lib/db/tests/accounting-export.test.mjs
```

Las pruebas de integración requieren la API y PostgreSQL de desarrollo
configurados. No deben dirigirse a producción.

## Próxima integración prioritaria

Vincular empleados de RR. HH. con los trabajadores de Seguridad Social y
proporcionar fuentes revisables desde nóminas para cotizaciones, retenciones
y asientos contables. Debe conservar referencias, permisos por empresa,
aprobaciones, idempotencia y trazabilidad; no debe convertir una nómina en
un pago, asiento o presentación fiscal automática sin el flujo autorizado.
