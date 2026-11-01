# Ensayo reproducible de copia y restauración

## Alcance y condición de apertura de centros

Este ensayo realiza una copia y una restauración **reales de PostgreSQL**, sobre
una base recién creada con **datos exclusivamente ficticios**. No usa ni copia la
base del proyecto, desarrollo o producción. No utiliza datos del usuario.
No ejecuta las acciones didácticas de backup del ERP: esas acciones no prueban
la recuperabilidad de la infraestructura.

La prueba de archivos emplea un **adaptador local de App Storage**, sin conectar
con el servicio ni con sus buckets. Comprueba la recuperación de referencias,
contenido, metadatos privados y permisos en el API real. **No acredita** la copia,
restauración, IAM, ACL de proveedor, retención ni acceso anónimo del bucket real.
No debe interpretarse el resultado como autorización suficiente para abrir
centros ni como una certificación de recuperación de producción.

Antes de abrir centros, además de los controles de `README.md`, la persona
responsable debe definir copias cifradas y retención, responsables, frecuencia,
RPO (pérdida máxima admisible) y RTO (tiempo de recuperación admisible), y verificar
por separado la restauración de objetos en un **bucket desechable independiente**
sin documentos ni credenciales de usuarios.

## Ejecutar

Requisitos:

- Linux, usuario **no root**, Node y pnpm compatibles con `package.json`.
- Dependencias del workspace ya instaladas.
- PostgreSQL local con `initdb`, `pg_ctl`, `psql`, `pg_dump` y `pg_restore` en `PATH`,
  todos de la misma versión mayor. Se ha ejecutado con PostgreSQL 16.
- Espacio de escritura bajo `generated-artifacts/`.

Desde la raíz:

```sh
pnpm run test:recovery
```

No requiere un servidor web arrancado ni secretos. **No pases una URL de base de
datos**, un bucket ni directorios de origen: el programa rechaza argumentos.
No hay que modificar `DATABASE_URL` ni ejecutar `push`/`push-force`.
En GitHub Actions se ejecuta el mismo comando usando un clúster local adicional,
sin reutilizar la base del servicio de integración.

Resultado: salida `PASS` y código 0. Cualquier aserción o comando fallido devuelve
un código distinto de cero. Solo tras completar la limpieza se escribe
`generated-artifacts/recovery-drill-result.json`, con inventario y huellas SHA-256.
El resultado anterior se borra al iniciar para no confundirlo con una ejecución
actual fallida. Este directorio está excluido de Git y de la publicación.

## Aislamiento y pasos del ensayo

1. Crear un directorio aleatorio `generated-artifacts/recovery-*` con modo 0700
   y `umask 077`. Construir un entorno permitido mínimo: no heredar `DATABASE_URL`,
   contraseñas `PG*`, secretos de sesión ni configuración de App Storage.
   La biblioteca PostgreSQL se carga después de aislar ese entorno.
2. Inicializar un clúster PostgreSQL nuevo con usuario local de ensayo. No tiene
   listener TCP; solo un socket Unix privado. La autenticación local `trust`
   se limita al directorio privado y las conexiones de red se rechazan.
   Crear `recovery_source` y `recovery_target` dentro de ese clúster.
3. Generar SQL **sin conexión a una base configurada**, a partir de
   `lib/db/src/schema/index.ts` y todas sus exportaciones. Aplicarlo únicamente
   al origen desechable con `psql -X` y `ON_ERROR_STOP`.
4. Insertar las fixtures explícitas de `lib/db/scripts/recovery-fixture.mjs`:
   dos redes, tres empresas, cinco usuarios ficticios y sus membresías/sesiones,
   pedido, factura y líneas, cobro parcial, cuentas, asiento equilibrado e
   historial; expediente, documento restringido, dos versiones e historial.
   No se generan contraseñas válidas ni se habilitan integraciones.
5. Inventariar **todas** las tablas, incluidas las vacías: número de filas y
   SHA-256 del contenido ordenado; guardar también columnas, restricciones e
   índices. Las tablas vacías tienen cobertura estructural, no funcional.
6. Crear `pg_dump --format=custom --no-owner --no-acl` del origen. Copiar
   separadamente el archivo ficticio y el metadato `custom:aclPolicy` privado.
   El manifiesto relaciona ruta lógica `/objects/uploads/...`, tamaño, SHA-256,
   propietario y visibilidad. Una copia SQL **no contiene** los binarios.
7. Eliminar la base de origen y el directorio de archivos de origen.
   Restaurar con `pg_restore --exit-on-error --single-transaction --no-owner
   --no-acl` en el destino vacío; restaurar los archivos en otro directorio privado.
   Así no se puede aprobar leyendo accidentalmente el origen.
8. Comparar inventarios completos y catálogo estructural. Comprobar claves
   foráneas validadas y rechazos reales de referencia huérfana y clave duplicada.
   Verificar relaciones comerciales, saldos, asiento e historial económico.
9. Verificar expediente/empresa/versiones, rutas, checksum, tamaño y permisos
   locales del archivo recuperado. Mantener las rutas lógicas, pero cambiar la
   raíz física al destino privado, nunca a un prefijo público.
10. Compilar el arnés `artifacts/api-server/scripts/recovery-access.ts`, arrancar
    el API real solo en `127.0.0.1` con puerto efímero y la base restaurada.
    Sustituir **solo en ese proceso** la lectura de objetos por el adaptador local.
    La autorización de sesiones, membresías, red, empresa y documento sigue
    siendo la del producto, sin modificaciones.
11. Comprobar descarga: propietario 302 con `Cache-Control: no-store`; anónimo e
    inactivo 401; compañero no propietario, otra empresa y otra red 404.
    Los accesos denegados no leen almacenamiento ni reciben enlace.
    Comprobar también denegación de rutas públicas/directas y ejecutar la función
    real de ACL sobre el metadato restaurado: sin identidad y otra identidad,
    denegadas; propietario, autorizado. La URL devuelta es ficticia bajo
    `recovery.invalid` y no se sigue ni firma contra un proveedor.
12. Escribir en la copia restaurada y confirmar que el origen ya no existe.
    Cerrar el API y las conexiones; detener el clúster y eliminar todo el
    directorio temporal, incluidas bases, copias, archivos, sesiones y arnés.
    Dejar únicamente la evidencia sintética indicada arriba.

`--no-owner --no-acl` impide importar propietarios y concesiones PostgreSQL
externos. **No equivale** a restaurar usuarios/grants del proveedor. El ensayo
sí restaura y comprueba los permisos de aplicación almacenados en membresías.

## Resultados observados

Registro de ejecución y alcance: véase [recovery-drill-results.md](recovery-drill-results.md).
Los inventarios completos se regeneran con cada ejecución, no se versionan.
No se han leído ni modificado bases de usuario, buckets ni archivos existentes.

## Limpieza y fallos

La limpieza se ejecuta en `finally`, también si fallan generación, fixtures,
restauración o permisos; SIGINT y SIGTERM detienen el clúster y eliminan el
directorio. Las ejecuciones fallidas durante la preparación del arnés confirmaron
también esta limpieza.

Una terminación forzada (`SIGKILL`), caída del sistema o falta de permisos puede
impedir ejecutar código de limpieza. En ese caso:

1. Identificar el directorio concreto `generated-artifacts/recovery-*` de esa
   ejecución; no usar comodines para borrar ni tocar otros clústeres.
2. Confirmar que `cluster/postmaster.pid`, si existe, corresponde a ese directorio.
3. Ejecutar `pg_ctl -D <directorio-concreto>/cluster -m immediate -w stop`.
   Si indica que no hay servidor, verificar que no sigue ejecutándose ese proceso.
4. Eliminar únicamente ese directorio de ensayo una vez detenido.

Si no se puede detener el clúster, el programa falla y **no borra su directorio**;
resuelve el proceso antes de eliminarlo. No se debe resolver ningún fallo
reintentando contra la base del proyecto ni producción.

## Recuperación con App Storage: contrato que debe conservarse

`artifacts/api-server/src/lib/objectStorage.ts` resuelve las rutas lógicas mediante
`PRIVATE_OBJECT_DIR`. La tabla de versiones guarda `object_path`, tamaño, checksum
y estado; los metadatos de objetos contienen la ACL por separado. La descarga
real exige autorización de documento y emite un enlace temporal, no publica el
archivo.

Para un ensayo futuro con un proveedor real, mantener el mismo contrato:

- Origen y destino de prueba independientes, ambos con datos ficticios.
- Manifiesto por cada versión, bytes y metadatos; coordinar el punto de copia
  SQL/objetos para no tener versiones confirmadas sin archivo.
- Destino privado sin `allUsers`/`allAuthenticatedUsers`, ACL privada y sin
  solapamiento con `PUBLIC_OBJECT_SEARCH_PATHS`; verificar también IAM heredado.
- Reasignar `PRIVATE_OBJECT_DIR` solo en el servicio aislado de prueba,
  conservar o remapear explícitamente las referencias lógicas.
- Verificar rechazo de GET anónimo **directamente contra el proveedor**, no solo
  a través del API, y descarga temporal autorizada con checksum coincidente.
- No arrancar tareas de IA, mensajes, integraciones o procesos programados al
  conectar una copia restaurada. No copiar sesiones reales a un entorno de prueba.
- Borrar objetos, generaciones y entornos desechables al terminar. Documentar
  por separado el tratamiento de versiones retenidas y las limitaciones de borrado.

Estas verificaciones de proveedor no se han ejecutado en el ensayo local.
