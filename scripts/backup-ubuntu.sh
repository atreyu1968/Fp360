#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_SERVICE="redfp360"
DB_NAME="redfp360"
OBJECT_ROOT="/var/lib/redfp360/objects"
BACKUP_FORMAT="redfp360-backup-v1"
DEFAULT_STATUS_FILE="/var/lib/redfp360/backup-status"

usage() {
  cat <<'USAGE'
Uso:
  sudo scripts/backup-ubuntu.sh backup --destination DIR --passphrase-file FILE
  sudo scripts/backup-ubuntu.sh scheduled-backup --destination DIR --passphrase-file FILE
    [--status-file FILE] [--max-age-hours HOURS]
  sudo scripts/backup-ubuntu.sh status [--status-file FILE] [--max-age-hours HOURS]
  sudo scripts/backup-ubuntu.sh restore-drill --backup FILE --passphrase-file FILE

backup crea un único archivo cifrado con PostgreSQL y /var/lib/redfp360/objects.
La API se detiene durante la captura para mantener coherentes los datos y archivos.
scheduled-backup exige que el destino sea exactamente un punto de montaje.
status informa del último éxito y avisa si supera la antigüedad máxima.
restore-drill restaura en una base temporal, comprueba referencias a archivos y
elimina la base y los archivos temporales al terminar. No modifica la instalación.

El destino debe existir y ser un almacenamiento protegido, preferiblemente externo
al servidor. El archivo de frase secreta debe pertenecer a root y tener modo 0600.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "Ejecuta este comando con sudo."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Falta el comando requerido: $1."
}

validate_passphrase_file() {
  local file="$1" mode owner
  [[ "$file" = /* && -f "$file" && ! -L "$file" ]] \
    || fail "La frase secreta debe estar en un archivo regular con ruta absoluta."
  owner="$(stat -c '%u' -- "$file")"
  mode="$(stat -c '%a' -- "$file")"
  [[ "$owner" == 0 ]] || fail "El archivo de frase secreta debe pertenecer a root."
  (( (8#$mode & 077) == 0 )) || fail "El archivo de frase secreta no puede permitir acceso a grupo u otros."
  [[ -s "$file" ]] || fail "El archivo de frase secreta está vacío."
}

make_work_dir() {
  local parent="${TMPDIR:-/var/tmp}"
  [[ -d "$parent" && -w "$parent" ]] || fail "No se puede escribir el directorio temporal."
  WORK_DIR="$(mktemp -d "$parent/redfp360-backup.XXXXXXXX")"
  chmod 0700 "$WORK_DIR"
}

cleanup() {
  local status=$?
  if [[ "${APP_STOPPED:-0}" -eq 1 ]]; then
    if ! systemctl start "$APP_SERVICE" || ! systemctl is-active --quiet "$APP_SERVICE"; then
      printf 'ERROR: la API no pudo reiniciarse automáticamente; revisa systemctl status %s.\n' "$APP_SERVICE" >&2
      status=1
    else
      APP_STOPPED=0
      printf 'La API se reinició después de una salida anticipada.\n' >&2
    fi
  fi
  if [[ -n "${STAGED_ARCHIVE:-}" && -e "$STAGED_ARCHIVE" ]]; then
    if ! rm -f -- "$STAGED_ARCHIVE"; then
      printf 'ERROR: no se pudo eliminar la copia temporal incompleta: %s\n' "$STAGED_ARCHIVE" >&2
      status=1
    fi
  fi
  if [[ -n "${DRILL_DB:-}" ]]; then
    if ! runuser -u postgres -- dropdb --if-exists -- "$DRILL_DB"; then
      printf 'ERROR: no se pudo eliminar la base temporal %s; elimínala manualmente tras comprobarla.\n' "$DRILL_DB" >&2
      status=1
      KEEP_WORK_DIR=1
    fi
  fi
  if [[ -n "${WORK_DIR:-}" && "${KEEP_WORK_DIR:-0}" -eq 0 ]]; then
    rm -rf -- "$WORK_DIR"
  elif [[ -n "${WORK_DIR:-}" ]]; then
    printf 'Se conserva el directorio temporal de recuperación: %s\n' "$WORK_DIR" >&2
  fi
  exit "$status"
}

check_backup_files() {
  local extracted="$1"
  [[ -f "$extracted/manifest.txt" && -f "$extracted/database.dump" && -f "$extracted/objects.tar" && -f "$extracted/checksums.sha256" ]] \
    || fail "El archivo no contiene todos los componentes requeridos."
  (cd "$extracted" && sha256sum --check --strict checksums.sha256) \
    || fail "La huella de un componente no coincide."
  grep -Fqx "format=$BACKUP_FORMAT" "$extracted/manifest.txt" \
    || fail "Formato de copia no compatible."
}

validate_status_file() {
  local file="$1"
  [[ "$file" = /* ]] || fail "El archivo de estado debe usar una ruta absoluta."
  [[ ! -L "$file" ]] || fail "El archivo de estado no puede ser un enlace simbólico."
  [[ -d "$(dirname -- "$file")" && ! -L "$(dirname -- "$file")" ]] \
    || fail "El directorio del archivo de estado debe existir y no ser un enlace simbólico."
}

write_backup_status() {
  local file="$1" timestamp temporary
  validate_status_file "$file"
  timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  temporary="$(mktemp "$(dirname -- "$file")/.redfp360-backup-status.XXXXXXXX")"
  chmod 0600 "$temporary"
  printf '%s\n' "$timestamp" > "$temporary"
  mv -f -- "$temporary" "$file"
  printf 'Último respaldo satisfactorio: %s UTC.\n' "$timestamp"
}

show_backup_status() {
  local file="$1" max_age_hours="$2" timestamp timestamp_epoch now_epoch age_seconds
  [[ "$max_age_hours" =~ ^[1-9][0-9]*$ ]] && ((max_age_hours <= 87600)) \
    || fail "--max-age-hours debe ser un entero entre 1 y 87600."
  validate_status_file "$file"
  if [[ ! -f "$file" ]]; then
    printf 'No hay ningún respaldo satisfactorio registrado.\n' >&2
    printf 'AVISO: no existe una copia reciente; comprueba el montaje y configura el respaldo.\n' >&2
    return 1
  fi
  timestamp="$(cat -- "$file")"
  [[ "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || fail "El estado del último respaldo no contiene una fecha válida."
  timestamp_epoch="$(date -u -d "$timestamp" +%s 2>/dev/null)" \
    || fail "No se pudo interpretar la fecha del último respaldo."
  now_epoch="$(date -u +%s)"
  ((timestamp_epoch <= now_epoch)) || fail "La fecha del último respaldo está en el futuro."
  age_seconds=$((now_epoch - timestamp_epoch))
  printf 'Último respaldo satisfactorio: %s UTC.\n' "$timestamp"
  if ((age_seconds > max_age_hours * 3600)); then
    printf 'AVISO: el último respaldo supera el límite de %s horas; comprueba systemctl status redfp360-backup.service y el montaje externo.\n' \
      "$max_age_hours" >&2
    return 1
  fi
  printf 'El respaldo está dentro del límite de %s horas.\n' "$max_age_hours"
}

backup() {
  local destination="" passphrase_file="" backup_dir archive_name staged_archive resolved_destination mount_target status_file="$DEFAULT_STATUS_FILE" require_mountpoint=0
  require_root
  while (($#)); do
    case "$1" in
      --destination) (($# >= 2)) || fail "--destination requiere un directorio."; destination="$2"; shift 2 ;;
      --passphrase-file) (($# >= 2)) || fail "--passphrase-file requiere un archivo."; passphrase_file="$2"; shift 2 ;;
      --status-file) (($# >= 2)) || fail "--status-file requiere un archivo."; status_file="$2"; shift 2 ;;
      --require-mountpoint) require_mountpoint=1; shift ;;
      *) fail "Opción desconocida: $1" ;;
    esac
  done
  [[ "$destination" = /* && -d "$destination" && ! -L "$destination" ]] \
    || fail "El destino debe ser un directorio existente, absoluto y no simbólico."
  [[ -n "$passphrase_file" ]] || fail "Indica --passphrase-file."
  validate_passphrase_file "$passphrase_file"
  require_command gpg
  require_command pg_dump
  require_command tar
  require_command sha256sum
  require_command systemctl
  require_command runuser
  require_command findmnt

  resolved_destination="$(realpath -e -- "$destination")"
  [[ "$resolved_destination" != /var/lib/redfp360 && "$resolved_destination" != /var/lib/redfp360/* ]] \
    || fail "El destino no puede estar dentro de los datos originales."
  mount_target="$(findmnt -n -o TARGET --target "$resolved_destination")" \
    || fail "No se pudo identificar el volumen de destino."
  [[ "$mount_target" != "/" ]] \
    || fail "El destino debe estar en un volumen montado aparte, no en el sistema de archivos raíz."
  if ((require_mountpoint)); then
    [[ "$(realpath -e -- "$mount_target")" == "$resolved_destination" ]] \
      || fail "El punto de montaje externo esperado no está montado en $resolved_destination."
  fi
  validate_status_file "$status_file"
  destination="$resolved_destination"
  backup_dir="$destination/redfp360"
  [[ ! -L "$backup_dir" ]] || fail "El directorio de copias no puede ser un enlace simbólico."
  install -d -m 0700 -o root -g root -- "$backup_dir"
  [[ ! -L "$backup_dir" && "$(stat -c '%u:%a' "$backup_dir")" == "0:700" ]] \
    || fail "El destino $backup_dir debe ser un directorio privado de root con modo 0700."
  [[ -d "$OBJECT_ROOT/private/uploads" && ! -L "$OBJECT_ROOT" && ! -L "$OBJECT_ROOT/private" && ! -L "$OBJECT_ROOT/private/uploads" ]] \
    || fail "No encuentro el almacenamiento local privado de documentos en $OBJECT_ROOT."
  systemctl is-active --quiet postgresql || fail "PostgreSQL no está activo."
  systemctl is-active --quiet "$APP_SERVICE" || fail "La API debe estar activa antes de iniciar una copia."

  make_work_dir
  trap cleanup EXIT
  mkdir -m 0700 "$WORK_DIR/payload"

  printf 'Deteniendo %s para capturar PostgreSQL y documentos en el mismo punto...\n' "$APP_SERVICE"
  APP_STOPPED=1
  systemctl stop "$APP_SERVICE"
  if ! runuser -u postgres -- pg_dump --format=custom --no-owner --no-acl --dbname="$DB_NAME" \
    > "$WORK_DIR/payload/database.dump"; then
    fail "pg_dump falló; no se publicará una copia incompleta."
  fi
  tar --numeric-owner -C /var/lib/redfp360 -cf "$WORK_DIR/payload/objects.tar" objects
  systemctl start "$APP_SERVICE"
  APP_STOPPED=0
  systemctl is-active --quiet "$APP_SERVICE" || fail "La API no volvió a quedar activa tras la captura."

  {
    printf 'format=%s\n' "$BACKUP_FORMAT"
    printf 'created_utc=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf 'database=%s\n' "$DB_NAME"
    printf 'objects_root=%s\n' "$OBJECT_ROOT"
    runuser -u postgres -- pg_dump --version | sed 's/^/pg_dump_version=/'
  } > "$WORK_DIR/payload/manifest.txt"
  (cd "$WORK_DIR/payload" && sha256sum database.dump objects.tar > checksums.sha256)

  archive_name="redfp360-$(date -u +'%Y%m%dT%H%M%SZ').tar.gz.gpg"
  staged_archive="$backup_dir/.${archive_name}.tmp"
  [[ ! -e "$backup_dir/$archive_name" && ! -e "$staged_archive" ]] || fail "Ya existe una copia con esa fecha."
  tar -C "$WORK_DIR/payload" -czf "$WORK_DIR/backup.tar.gz" manifest.txt checksums.sha256 database.dump objects.tar
  STAGED_ARCHIVE="$staged_archive"
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$passphrase_file" \
    --symmetric --cipher-algo AES256 --output "$staged_archive" "$WORK_DIR/backup.tar.gz"
  chmod 0600 "$staged_archive"
  mv -- "$staged_archive" "$backup_dir/$archive_name"
  printf 'Copia cifrada creada: %s/%s\n' "$backup_dir" "$archive_name"
  printf 'Verifica que el archivo aparezca en tu política externa de retención.\n'
  write_backup_status "$status_file"
}

scheduled_backup() {
  local destination="" passphrase_file="" status_file="$DEFAULT_STATUS_FILE" max_age_hours=36
  require_root
  while (($#)); do
    case "$1" in
      --destination) (($# >= 2)) || fail "--destination requiere un directorio."; destination="$2"; shift 2 ;;
      --passphrase-file) (($# >= 2)) || fail "--passphrase-file requiere un archivo."; passphrase_file="$2"; shift 2 ;;
      --status-file) (($# >= 2)) || fail "--status-file requiere un archivo."; status_file="$2"; shift 2 ;;
      --max-age-hours) (($# >= 2)) || fail "--max-age-hours requiere un número."; max_age_hours="$2"; shift 2 ;;
      *) fail "Opción desconocida: $1" ;;
    esac
  done
  [[ -n "$destination" ]] || fail "Indica --destination."
  [[ -n "$passphrase_file" ]] || fail "Indica --passphrase-file."
  if (backup --destination "$destination" --passphrase-file "$passphrase_file" \
      --status-file "$status_file" --require-mountpoint); then
    show_backup_status "$status_file" "$max_age_hours"
  else
    local backup_status=$?
    show_backup_status "$status_file" "$max_age_hours" || true
    return "$backup_status"
  fi
}

status() {
  local status_file="$DEFAULT_STATUS_FILE" max_age_hours=36
  require_root
  while (($#)); do
    case "$1" in
      --status-file) (($# >= 2)) || fail "--status-file requiere un archivo."; status_file="$2"; shift 2 ;;
      --max-age-hours) (($# >= 2)) || fail "--max-age-hours requiere un número."; max_age_hours="$2"; shift 2 ;;
      *) fail "Opción desconocida: $1" ;;
    esac
  done
  show_backup_status "$status_file" "$max_age_hours"
}

restore_drill() {
  local backup_file="" passphrase_file="" references_file object_path checksum expected_size file_path actual_size actual_hash
  require_root
  while (($#)); do
    case "$1" in
      --backup) (($# >= 2)) || fail "--backup requiere un archivo."; backup_file="$2"; shift 2 ;;
      --passphrase-file) (($# >= 2)) || fail "--passphrase-file requiere un archivo."; passphrase_file="$2"; shift 2 ;;
      *) fail "Opción desconocida: $1" ;;
    esac
  done
  [[ "$backup_file" = /* && -f "$backup_file" && ! -L "$backup_file" ]] \
    || fail "La copia debe ser un archivo regular con ruta absoluta."
  [[ -n "$passphrase_file" ]] || fail "Indica --passphrase-file."
  validate_passphrase_file "$passphrase_file"
  require_command gpg
  require_command pg_restore
  require_command psql
  require_command createdb
  require_command dropdb
  require_command tar
  require_command sha256sum
  require_command runuser
  require_command systemctl
  systemctl is-active --quiet postgresql || fail "PostgreSQL debe estar activo para el ensayo."

  make_work_dir
  trap cleanup EXIT
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$passphrase_file" \
    --decrypt --output "$WORK_DIR/backup.tar.gz" "$backup_file"
  mkdir -m 0700 "$WORK_DIR/payload"
  tar --no-same-owner --no-same-permissions -xzf "$WORK_DIR/backup.tar.gz" -C "$WORK_DIR/payload"
  check_backup_files "$WORK_DIR/payload"
  tar --no-same-owner --no-same-permissions -xf "$WORK_DIR/payload/objects.tar" -C "$WORK_DIR"
  [[ -d "$WORK_DIR/objects/private/uploads" && ! -L "$WORK_DIR/objects" && ! -L "$WORK_DIR/objects/private" && ! -L "$WORK_DIR/objects/private/uploads" ]] \
    || fail "El archivo no contiene el directorio privado de objetos esperado."
  chgrp postgres "$WORK_DIR" "$WORK_DIR/payload" "$WORK_DIR/payload/database.dump"
  chmod 0710 "$WORK_DIR" "$WORK_DIR/payload"
  chmod 0640 "$WORK_DIR/payload/database.dump"

  DRILL_DB="redfp360_restore_drill_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
  runuser -u postgres -- createdb --template=template0 -- "$DRILL_DB"
  runuser -u postgres -- pg_restore --exit-on-error --single-transaction --no-owner --no-acl \
    --dbname="$DRILL_DB" "$WORK_DIR/payload/database.dump"

  references_file="$WORK_DIR/references.tsv"
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -At -F $'\t' --dbname="$DRILL_DB" > "$references_file" <<'SQL'
SELECT object_path, COALESCE(checksum_sha256, '-'), size_bytes
FROM fp360_document_versions
WHERE status = 'uploaded' AND object_path IS NOT NULL
UNION ALL
SELECT object_path, '-', size_bytes
FROM fp360_product_documents
WHERE status = 'ready'
ORDER BY 1;
SQL
  local verified=0
  while IFS=$'\t' read -r object_path checksum expected_size; do
    [[ -n "$object_path" ]] || continue
    [[ "$checksum" != "-" ]] || checksum=""
    [[ "$object_path" =~ ^/objects/uploads/([a-fA-F0-9-]{36})$ ]] \
      || fail "La base restaurada contiene una ruta de objeto fuera del formato local esperado."
    file_path="$WORK_DIR/objects/private/uploads/${BASH_REMATCH[1]}"
    [[ -f "$file_path" && ! -L "$file_path" ]] \
      || fail "Una referencia de documento restaurada no tiene archivo: $object_path."
    actual_size="$(stat -c '%s' -- "$file_path")"
    [[ "$actual_size" == "$expected_size" ]] \
      || fail "El tamaño del archivo restaurado no coincide para $object_path."
    if [[ -n "$checksum" ]]; then
      [[ "$checksum" =~ ^[a-fA-F0-9]{64}$ ]] || fail "La base restaurada contiene un checksum no válido."
      actual_hash="$(sha256sum -- "$file_path" | cut -d ' ' -f 1)"
      [[ "${actual_hash,,}" == "${checksum,,}" ]] \
        || fail "El checksum del archivo restaurado no coincide para $object_path."
    fi
    ((verified += 1))
  done < "$references_file"
  ((verified > 0)) || fail "El ensayo no encontró documentos subidos/activos para comprobar; añade una referencia de documento antes de repetirlo."

  printf 'PASS: copia descifrada y comprobada; base temporal %s restaurada; %s referencias verificadas contra archivos privados y metadatos.\n' \
    "$DRILL_DB" "$verified"
  printf 'El ensayo no ha modificado la base de producción ni el directorio de objetos.\n'
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

[[ $# -gt 0 ]] || { usage >&2; exit 2; }
command="$1"
shift
case "$command" in
  backup) backup "$@" ;;
  scheduled-backup) scheduled_backup "$@" ;;
  status) status "$@" ;;
  restore-drill) restore_drill "$@" ;;
  --help|-h|help) usage ;;
  *) usage >&2; fail "Comando desconocido: $command" ;;
esac
