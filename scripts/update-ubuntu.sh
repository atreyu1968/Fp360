#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="/opt/redfp360"
CONFIG_DIR="/etc/redfp360"
DATA_DIR="/var/lib/redfp360"
SERVICE_NAME="redfp360"
SERVICE_USER="redfp360"
REPOSITORY="https://github.com/atreyu1968/Fp360.git"
REF="main"
HEALTH_URL="http://127.0.0.1:8080/api/healthz"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  cat <<'USAGE'
Actualiza RED FP360 en Ubuntu sin preguntas interactivas.

Uso:
  sudo /opt/redfp360/scripts/update-ubuntu.sh [--ref RAMA_O_TAG]

La actualización valida el build, compara el esquema, exige una copia externa
cifrada y conserva hasta dos versiones anteriores del código. Si el esquema de
la base cambia, se detiene antes de modificar la instalación: no aplica cambios
de base de datos automáticamente.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --ref)
      (($# >= 2)) || fail "--ref necesita un nombre de rama o etiqueta."
      REF="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Opción desconocida: $1"
      ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "Ejecuta el actualizador con sudo."
[[ "$REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] \
  || fail "--ref debe ser una rama o etiqueta Git válida."
if ! git check-ref-format --branch "$REF" >/dev/null 2>&1 \
  && ! git check-ref-format "refs/tags/$REF" >/dev/null 2>&1; then
  fail "--ref debe ser una rama o etiqueta Git válida."
fi

for command_name in git pnpm node systemctl curl diff flock mountpoint runuser; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "Falta el comando requerido: $command_name."
done

[[ -d "$APP_DIR" && -f "$APP_DIR/pnpm-workspace.yaml" ]] \
  || fail "No encuentro una instalación válida en $APP_DIR."
[[ -d "$APP_DIR/lib/db/src/schema" && -d "$CONFIG_DIR" && -d "$DATA_DIR/objects" ]] \
  || fail "La instalación no contiene el esquema, la configuración o los documentos esperados."
id "$SERVICE_USER" >/dev/null 2>&1 \
  || fail "No existe el usuario de servicio $SERVICE_USER."
[[ -f "$APP_DIR/scripts/backup-ubuntu.sh" ]] \
  || fail "La instalación no incluye el procedimiento de copia coordinada."
[[ -f "$CONFIG_DIR/backup.env" && "$(stat -c '%u' "$CONFIG_DIR/backup.env")" == "0" ]] \
  || fail "La configuración de copias debe existir y pertenecer a root."
config_mode="$(stat -c '%a' "$CONFIG_DIR/backup.env")"
(( (8#$config_mode & 077) == 0 )) \
  || fail "La configuración de copias no puede permitir acceso a grupo u otros."

exec 9>/run/lock/redfp360-update.lock
flock -n 9 || fail "Ya hay otra actualización en curso."
systemctl is-active --quiet "$SERVICE_NAME" \
  || fail "La API no está activa; no actualizaré una instalación degradada."

# This file is created by the installer and is root-owned with mode 0600.
# shellcheck disable=SC1091
source "$CONFIG_DIR/backup.env"
BACKUP_DESTINATION="${RED_FP360_BACKUP_DESTINATION:-}"
BACKUP_PASSPHRASE_FILE="${RED_FP360_BACKUP_PASSPHRASE_FILE:-}"
[[ "$BACKUP_DESTINATION" =~ ^/[A-Za-z0-9_./-]+$ ]] \
  || fail "La ruta de copias configurada no es válida."
[[ "$BACKUP_PASSPHRASE_FILE" =~ ^/[A-Za-z0-9_./-]+$ ]] \
  || fail "La ruta de la frase secreta configurada no es válida."
mountpoint -q "$BACKUP_DESTINATION" \
  || fail "El destino de copias no está montado: $BACKUP_DESTINATION."
[[ -f "$BACKUP_PASSPHRASE_FILE" && ! -L "$BACKUP_PASSPHRASE_FILE" ]] \
  || fail "No existe el archivo de frase secreta para las copias."
[[ "$(stat -c '%u' "$BACKUP_PASSPHRASE_FILE")" == "0" ]] \
  || fail "El archivo de frase secreta debe pertenecer a root."
mode="$(stat -c '%a' "$BACKUP_PASSPHRASE_FILE")"
(( (8#$mode & 077) == 0 )) \
  || fail "El archivo de frase secreta no puede permitir acceso a grupo u otros."

STAGE="$(mktemp -d /opt/.redfp360-update.XXXXXX)"
chown "$SERVICE_USER:$SERVICE_USER" "$STAGE"
REPO_DIR="$STAGE/source"
ROLLBACK_DIR="/opt/redfp360.rollback.${TIMESTAMP}"
FAILED_DIR="/opt/redfp360.failed.${TIMESTAMP}"
ROLLBACK_ACTIVE=0
NEW_RELEASE_FILE=""

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$ROLLBACK_ACTIVE" -eq 1 && -d "$ROLLBACK_DIR" ]]; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    if [[ -d "$APP_DIR" ]]; then
      mv "$APP_DIR" "$FAILED_DIR" 2>/dev/null || true
    fi
    if mv "$ROLLBACK_DIR" "$APP_DIR"; then
      if systemctl start "$SERVICE_NAME" >/dev/null 2>&1; then
        printf 'Se restauró automáticamente el código anterior desde %s.\n' "$ROLLBACK_DIR" >&2
        ROLLBACK_ACTIVE=0
      else
        printf 'ERROR: restaura manualmente el código desde %s; la API no pudo arrancar.\n' "$ROLLBACK_DIR" >&2
        status=1
      fi
    else
      printf 'ERROR: no se pudo restaurar automáticamente el código desde %s.\n' "$ROLLBACK_DIR" >&2
      status=1
    fi
  fi
  if [[ -n "${STAGE:-}" && -d "$STAGE" ]]; then
    rm -rf -- "$STAGE"
  fi
  if [[ -n "${NEW_RELEASE_FILE:-}" && -e "$NEW_RELEASE_FILE" ]]; then
    rm -f -- "$NEW_RELEASE_FILE"
  fi
  exit "$status"
}
trap cleanup EXIT

printf 'Descargando RED FP360, referencia %s...\n' "$REF"
runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" \
  git clone --depth 1 --branch "$REF" "$REPOSITORY" "$REPO_DIR"

printf 'Comprobando que no hay cambios de esquema de base de datos...\n'
[[ -d "$REPO_DIR/lib/db/src/schema" && -f "$REPO_DIR/lib/db/drizzle.config.ts" ]] \
  || fail "La referencia descargada no contiene el esquema de base de datos."
NEW_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
if [[ -r "$DATA_DIR/release" && "$(cat "$DATA_DIR/release")" == "$NEW_COMMIT" ]]; then
  printf 'RED FP360 ya está en %s; no hay cambios que aplicar.\n' "$NEW_COMMIT"
  exit 0
fi
if ! diff -qr "$APP_DIR/lib/db/src/schema" "$REPO_DIR/lib/db/src/schema" >/dev/null \
  || ! cmp -s "$APP_DIR/lib/db/drizzle.config.ts" "$REPO_DIR/lib/db/drizzle.config.ts"; then
  fail "La referencia cambia el esquema de datos. Se requiere una migración revisada; producción no se ha modificado."
fi

printf 'Instalando dependencias y compilando la versión nueva...\n'
runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" \
  pnpm --dir "$REPO_DIR" install --frozen-lockfile
runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" PORT=19362 BASE_PATH=/ \
  pnpm --dir "$REPO_DIR" run build

printf 'Creando copia externa cifrada antes de actualizar...\n'
"$APP_DIR/scripts/backup-ubuntu.sh" backup \
  --destination "$BACKUP_DESTINATION" \
  --passphrase-file "$BACKUP_PASSPHRASE_FILE"
systemctl is-active --quiet "$SERVICE_NAME" \
  || fail "La API no se recuperó después de la copia; la versión instalada no se ha cambiado."

rm -rf -- "$REPO_DIR/.git"

systemctl stop "$SERVICE_NAME"
mv "$APP_DIR" "$ROLLBACK_DIR"
ROLLBACK_ACTIVE=1
if ! mv "$REPO_DIR" "$APP_DIR"; then
  fail "No se pudo activar la versión nueva; se restauró el código anterior."
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

if ! systemctl start "$SERVICE_NAME"; then
  fail "La API no arrancó con la versión nueva; se restaurará el código anterior."
fi

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent "$HEALTH_URL" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" -ne 1 ]]; then
  fail "La API nueva no pasó la comprobación de salud; se restaurará el código anterior."
fi

NEW_RELEASE_FILE="$(mktemp "$DATA_DIR/.release.XXXXXX")"
printf '%s\n' "$NEW_COMMIT" > "$NEW_RELEASE_FILE"
chown root:root "$NEW_RELEASE_FILE"
chmod 0644 "$NEW_RELEASE_FILE"
mv "$NEW_RELEASE_FILE" "$DATA_DIR/release"
NEW_RELEASE_FILE=""
ROLLBACK_ACTIVE=0

mapfile -t old_rollbacks < <(find /opt -mindepth 1 -maxdepth 1 -type d -name 'redfp360.rollback.*' -printf '%f\n' | sort -r | tail -n +3)
for old_rollback in "${old_rollbacks[@]}"; do
  [[ "$old_rollback" =~ ^redfp360\.rollback\.[0-9TZ]+\.[0-9]+$ ]] \
    && rm -rf -- "/opt/$old_rollback"
done

printf 'RED FP360 se actualizó correctamente a %s; la copia previa del código queda en %s.\n' \
  "${NEW_COMMIT}" "$ROLLBACK_DIR"
