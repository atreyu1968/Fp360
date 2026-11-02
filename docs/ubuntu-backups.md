# Copias y recuperación de RED FP360 en Ubuntu

Este procedimiento aplica a instalaciones Ubuntu con PostgreSQL local y
`RED_FP360_STORAGE_BACKEND=local`. Cada copia es **un solo archivo cifrado** que
contiene un `pg_dump` y el árbol `/var/lib/redfp360/objects`. El script detiene la
API durante la captura de ambos componentes y la vuelve a iniciar al terminar.
Las copias de Replit y App Storage siguen siendo responsabilidad de sus servicios
administrados; este procedimiento no las incluye.

## Preparar clave y destino

Instala las actualizaciones de la aplicación que incluyan
`/opt/redfp360/scripts/backup-ubuntu.sh`. Crea una frase aleatoria en un archivo
solo legible por root; no la escribas en un comando, argumento, historial, log o
archivo de copia:

```sh
sudo sh -c 'umask 077; openssl rand -base64 48 > /root/redfp360-backup.passphrase'
sudo chmod 0600 /root/redfp360-backup.passphrase
```

Protege la frase en un gestor de secretos independiente del destino de copias y
mantén una copia de recuperación bajo control de las personas responsables. Si
se pierde, los archivos cifrados no se pueden descifrar. No guardes la frase en
el mismo volumen o cuenta que las copias.

Monta primero un destino externo, cifrado y con acceso restringido; puede ser un
disco dedicado o un almacenamiento remoto montado por el sistema. No uses el
disco de datos del servidor como única copia. El directorio que se pasa al script
debe existir y no ser un enlace simbólico:

```sh
sudo mkdir -p /mnt/redfp360-backups
findmnt /mnt/redfp360-backups
```

Comprueba que `findmnt` muestra el volumen o montaje remoto esperado antes de
continuar. El script crea `/mnt/redfp360-backups/redfp360` con propietario root
y modo `0700`, y cifra el paquete con GnuPG simétrico AES-256. Ubuntu instala
GnuPG con el instalador de RED FP360.

## Crear una copia coordinada

```sh
sudo /opt/redfp360/scripts/backup-ubuntu.sh backup \
  --destination /mnt/redfp360-backups \
  --passphrase-file /root/redfp360-backup.passphrase
```

Se necesita una interrupción breve del servicio mientras se capturan PostgreSQL
y los objetos. Si la captura falla, el script no publica un archivo parcial e
intenta reiniciar la API. El resultado es un archivo
`redfp360-<fecha-UTC>.tar.gz.gpg`; PostgreSQL, objetos y sus huellas están dentro
del mismo paquete cifrado. Protege también el directorio de destino y limita su
acceso a administradores autorizados.

## Programación y aviso de retrasos

El instalador de Ubuntu activa un temporizador de systemd para ejecutar una copia
diaria a las 00:00 (hora local). Personaliza la frecuencia durante la instalación
con `--backup-frequency`, por ejemplo `daily`, `weekly` o una expresión válida
de `systemd.time`. También puedes elegir el punto de montaje y la ruta del archivo
de frase secreta con `--backup-destination` y `--backup-passphrase-file`.

La ruta configurada debe ser el propio punto de montaje, no una carpeta dentro de
él. El trabajo programado compara el montaje real con esa ruta antes de crear
archivos; si el disco o montaje remoto falta, no escribe en el sistema de archivos
local y el servicio queda registrado como fallido. El instalador prepara el
directorio de montaje si aún no existe, pero no monta ni configura el dispositivo.
El archivo de frase secreta debe existir antes de la primera ejecución.

El instalador permite cambiar el límite de retraso con
`--backup-max-age-hours` (36 horas de forma predeterminada). Consulta la última
ejecución y el estado de antigüedad con:

```sh
sudo /opt/redfp360/scripts/backup-ubuntu.sh status --max-age-hours 36
systemctl list-timers redfp360-backup.timer
sudo journalctl -u redfp360-backup.service
```

El archivo de estado se guarda en el disco local de la instalación, no en el
destino externo. Tras cada copia correcta muestra y actualiza la fecha UTC del
último éxito. Si falla una ejecución y la última copia supera el límite, el
registro del servicio contiene un aviso para revisar el montaje y el servicio.
Si nunca hubo una copia satisfactoria, también informa de ello. Los avisos se
consultan en el registro local de systemd; el instalador no envía correo ni
notificaciones a servicios externos. Para cambiar la frecuencia después de
instalar, edita `OnCalendar` en
`/etc/systemd/system/redfp360-backup.timer` y ejecuta:

```sh
sudo systemd-analyze calendar 'weekly'
sudo systemctl daemon-reload
sudo systemctl restart redfp360-backup.timer
```

## Retención y comprobación periódica

Como política inicial, conserva **30 copias diarias y 12 copias mensuales** en
destinos separados o con bloqueo de borrado. Ajusta el plazo a los requisitos de
recuperación y al espacio disponible. El script no elimina copias antiguas: eso
evita borrar el histórico por una configuración de retención errónea. Revisa
periódicamente el inventario y elimina copias vencidas solo después de comprobar
que las copias recientes están completas y que la política conserva las
mensuales. Conserva al menos una copia desconectada o con protección contra
modificaciones.

Ejecuta un ensayo después de la primera copia y, como mínimo, trimestralmente,
además de hacerlo después de cambios en almacenamiento, PostgreSQL o claves:

```sh
sudo /opt/redfp360/scripts/backup-ubuntu.sh restore-drill \
  --backup /mnt/redfp360-backups/redfp360/redfp360-<fecha-UTC>.tar.gz.gpg \
  --passphrase-file /root/redfp360-backup.passphrase
```

El ensayo descifra y verifica las huellas, restaura a una base temporal de
PostgreSQL y a un directorio privado temporal, y comprueba que cada versión de
documento subida y documento de catálogo activo encuentra su archivo. Comprueba
tamaño y, cuando la base lo registra, checksum SHA-256. Al finalizar elimina la
base y los archivos temporales. No cambia la base de producción ni los objetos
actuales. El ensayo falla si la copia no contiene al menos una referencia de
documento activa; prepara una copia de prueba con documentos de ejemplo antes
de evaluar una instalación nueva sin documentos.

Anota la fecha, el nombre de la copia, el resultado y el tiempo de recuperación
sin incluir la frase secreta ni rutas o datos de documentos reales. Un ensayo
solo de copia no demuestra que el destino externo, el montaje o la frase secreta
estén disponibles durante una emergencia.

## Recuperar en un servidor de reemplazo

Practica primero el ensayo anterior. Usa un servidor nuevo o una instalación de
recuperación vacía, con la misma versión compatible de PostgreSQL y espacio
suficiente. No ejecutes estos pasos sobre una instalación con datos que deban
conservarse. Mantén el servicio detenido hasta que base y objetos hayan sido
restaurados.

1. Copia una versión de confianza de la clave al servidor por un canal seguro y
   limita sus permisos a root (`chmod 0600`). Monta el destino cifrado y confirma
   que es el esperado.
2. Descifra y extrae la copia en un directorio root-only. Sustituye `<copia>` y
   `<frase>` por sus rutas reales:

   ```sh
   sudo install -d -m 0700 /root/redfp360-restore
   sudo install -d -m 0700 /root/redfp360-restore/payload
   sudo gpg --batch --pinentry-mode loopback \
     --passphrase-file <frase> \
     --decrypt --output /root/redfp360-restore/backup.tar.gz <copia>
   sudo tar -xzf /root/redfp360-restore/backup.tar.gz \
     -C /root/redfp360-restore/payload
   sudo bash -c 'cd /root/redfp360-restore/payload && sha256sum --check --strict checksums.sha256'
   sudo tar --no-same-owner --no-same-permissions \
     -xf /root/redfp360-restore/payload/objects.tar \
     -C /root/redfp360-restore
   sudo /opt/redfp360/scripts/backup-ubuntu.sh restore-drill \
     --backup <copia> --passphrase-file <frase>
   ```

   Completa el ensayo antes de sustituir datos. En el nuevo servidor instala
   primero RED FP360 para crear el rol `redfp360` y la base vacía. Si la
   restauración o una comprobación falla, no continúes con el cambio.
3. Restaura el volcado en una base temporal y propiedad del rol de aplicación.
   El nombre temporal debe estar libre:

   ```sh
   sudo runuser -u postgres -- createdb --template=template0 \
     --owner=redfp360 redfp360_recovered
   sudo runuser -u postgres -- pg_restore --exit-on-error --single-transaction \
     --no-owner --no-acl --role=redfp360 --dbname=redfp360_recovered \
     /root/redfp360-restore/payload/database.dump
   ```

4. Solo después de que la base y los archivos estén preparados, detén la API y
   cambia al conjunto recuperado. Los nombres `redfp360_empty_before_restore` y
   `objects.empty-before-restore` conservan el estado previo de la instalación
   nueva para permitir una revisión:

   ```sh
   sudo systemctl stop redfp360
   sudo mv /var/lib/redfp360/objects /var/lib/redfp360/objects.empty-before-restore
   sudo mv /root/redfp360-restore/objects /var/lib/redfp360/objects
   sudo chown -R redfp360:redfp360 /var/lib/redfp360/objects
   sudo runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres \
     -c 'ALTER DATABASE redfp360 RENAME TO redfp360_empty_before_restore'
   sudo runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres \
     -c 'ALTER DATABASE redfp360_recovered RENAME TO redfp360'
   sudo systemctl start redfp360
   ```

   Mantén la base y los objetos anteriores apartados hasta comprobar
   `/api/healthz` y la descarga autorizada de documentos previamente
   seleccionados. No copies los objetos bajo una ruta pública. El cambio debe
   realizarse con la API detenida; no ejecutes `push` ni `push-force` contra el
   volcado recuperado. Si falla el cambio de base o directorio, deja la API
   detenida y recupera el par anterior antes de volver a arrancarla.

La copia no incluye secretos de aplicación, usuarios PostgreSQL, configuración
de Caddy, certificados, DNS, ni la frase de cifrado. Prepara esos elementos por
separado con el gestor seguro correspondiente. El modo de restauración requiere
acceso de root y PostgreSQL local; no importes el volcado en una base con datos
que deban conservarse.
