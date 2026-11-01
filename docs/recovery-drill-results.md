# Resultado del ensayo local de recuperación

## Ejecución

- Fecha: **2026-11-01**, de 23:41:09 a 23:41:25 UTC.
- Comando: `pnpm run test:recovery`.
- Salida: **código 0**, todas las aserciones superadas.
- Herramientas: PostgreSQL / `pg_dump` **16.10**.
- Origen: clúster nuevo privado, solo socket Unix, sin TCP.
- Datos: exclusivamente ficticios; ninguna conexión a la base del proyecto,
  desarrollo o producción ni a App Storage.
- Copia: formato personalizado de `pg_dump`; restauración transaccional con
  `pg_restore`, sin propietarios ni concesiones PostgreSQL externas.

## Comprobaciones

| Control | Resultado observado |
| --- | --- |
| Esquema actual completo | 130 tablas; columnas, restricciones e índices idénticos tras restaurar |
| Contenido | Conteos y SHA-256 coincidentes en las 130 tablas; 17 contienen fixtures, las demás quedan vacías |
| Integridad referencial | 232 claves foráneas validadas; una membresía huérfana se rechaza con `23503` |
| Unicidad | Duplicar una empresa se rechaza con `23505` |
| Empresa/red | Tres empresas en dos redes; relaciones comprador, emisor, pedido y factura recuperadas |
| Historial económico | Factura 10.700 céntimos, cobro 4.000, pendiente 6.700; asiento 10.700/10.700, cuentas, líneas e historial recuperados |
| Permisos persistidos | Cinco usuarios ficticios con sesiones y membresías; actividad, empresa, red y rol conservados |
| Documentación | Expediente, documento restringido, dos versiones, historial y referencias a empresa recuperados |
| Archivo local privado | 46 bytes; SHA-256 `8b09a810e5ebb14a9a97d01525151a2fe8b9ce8b77205d0c86c0d3efbdc368e7`; metadato de propietario/visibilidad privada conservado; sin acceso para grupo/otros en el sistema de archivos |
| Descarga del propietario | API real: 302 a URL ficticia, `Cache-Control: no-store`; adaptador valida checksum del archivo restaurado |
| Anónimo / membresía inactiva | 401, sin enlace ni lectura del archivo |
| Compañero no propietario / otra empresa / otra red | 404, sin enlace ni lectura del archivo |
| ACL del objeto local | Función real de ACL: acceso anónimo y otra identidad denegados; propietario permitido |
| Rutas pública/directa | API completo: ruta pública 401, ruta directa 404; no devuelven el archivo |
| Independencia del destino | Base y archivos de origen eliminados **antes** de restaurar; escritura posterior solo en el destino |
| Limpieza | API cerrado; conexiones cerradas; clúster detenido; directorio temporal, bases, copias, archivos y sesiones eliminados |

Se conserva únicamente evidencia sintética regenerable bajo
`generated-artifacts/recovery-drill-result.json` y la salida local de la ejecución.
No se conservan copias de base de datos ni archivos privados en Git.

La limpieza también se ejecutó correctamente en ejecuciones fallidas durante
la preparación de las fixtures y la compilación del arnés; no quedaron clústeres
ni directorios temporales de esas ejecuciones.

## Límites: lo que NO se ha probado

- El archivo es ficticio y el almacenamiento es un **adaptador local**, no un
  bucket de App Storage. No se ha hecho una petición al proveedor ni firmado
  una URL real. El rechazo del acceso público del proveedor sigue pendiente.
- No se han respaldado ni recuperado datos de usuarios ni de producción.
- No se han probado las operaciones funcionales de las tablas vacías, ni todos
  los roles del ERP; se compara su estructura y su contenido vacío.
- No se restauran usuarios/grants de PostgreSQL ni secretos de aplicación,
  claves de cifrado, MFA real o configuración del proveedor.
- No se ha probado recuperación a un instante concreto, carga equivalente a
  un centro, RPO/RTO, retención, generaciones de objetos ni coherencia de una
  copia realizada mientras se confirman nuevas cargas.
- No se ha usado el ejercicio didáctico de backup del ERP como evidencia.

**Conclusión:** la restauración del esquema actual y del conjunto ficticio,
incluidos permisos del API y documentos privados locales, es reproducible y
ha pasado. La recuperación integral de infraestructura con App Storage y la
preparación operativa para abrir centros **no quedan acreditadas** por este ensayo.
Procedimiento completo: [recovery-drill.md](recovery-drill.md).
