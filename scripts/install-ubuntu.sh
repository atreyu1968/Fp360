#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="/opt/redfp360"
CONFIG_DIR="/etc/redfp360"
DATA_DIR="/var/lib/redfp360/objects"
DB_NAME="redfp360"
DB_USER="redfp360"
SERVICE_USER="redfp360"
SERVICE_NAME="redfp360"
SETUP_TOKEN_FILE="/root/redfp360-setup-token"
UPGRADE_SYSTEM=0
DOMAIN=""
BACKUP_DESTINATION="/mnt/redfp360-backups"
BACKUP_PASSPHRASE_FILE="/root/redfp360-backup.passphrase"
BACKUP_FREQUENCY="daily"
BACKUP_MAX_AGE_HOURS="36"

usage() {
  cat <<'USAGE'
Instala RED FP360 en un Ubuntu Server limpio a partir de un checkout de GitHub.

Uso:
  sudo bash scripts/install-ubuntu.sh [opciones]

Opciones:
  --domain DOMINIO       Dominio DNS que apunta a este servidor (TLS por Caddy)
  --upgrade-system       Ofrece una actualización APT general, con confirmación
  --backup-destination DIR
                         Punto de montaje para copias (predeterminado: /mnt/redfp360-backups)
  --backup-passphrase-file FILE
                         Archivo de frase secreta (predeterminado: /root/redfp360-backup.passphrase)
  --backup-frequency CALENDAR
                         Frecuencia systemd (predeterminado: daily)
  --backup-max-age-hours HOURS
                         Antigüedad máxima antes de avisar (predeterminado: 36)
  --help                 Muestra esta ayuda

No borra ni reemplaza instalaciones existentes. El checkout debe contener
pnpm-workspace.yaml y .git. Para obtenerlo primero, consulta la sección
"Instalación en Ubuntu desde GitHub" del README. Los documentos se guardan
en un directorio privado del servidor sin depender de un servicio externo.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --domain)
      (($# >= 2)) || fail "--domain necesita un valor."
      DOMAIN="$2"; shift 2 ;;
    --backup-destination)
      (($# >= 2)) || fail "--backup-destination necesita un valor."
      BACKUP_DESTINATION="$2"; shift 2 ;;
    --backup-passphrase-file)
      (($# >= 2)) || fail "--backup-passphrase-file necesita un valor."
      BACKUP_PASSPHRASE_FILE="$2"; shift 2 ;;
    --backup-frequency)
      (($# >= 2)) || fail "--backup-frequency necesita un valor."
      BACKUP_FREQUENCY="$2"; shift 2 ;;
    --backup-max-age-hours)
      (($# >= 2)) || fail "--backup-max-age-hours necesita un valor."
      BACKUP_MAX_AGE_HOURS="$2"; shift 2 ;;
    --upgrade-system) UPGRADE_SYSTEM=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Opción desconocida: $1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "Ejecuta el instalador con sudo."
[[ "$BACKUP_DESTINATION" =~ ^/[A-Za-z0-9_./-]+$ ]] \
  || fail "--backup-destination debe ser una ruta absoluta sin espacios ni caracteres especiales."
[[ "$BACKUP_DESTINATION" != "/var/lib/redfp360" && "$BACKUP_DESTINATION" != "/var/lib/redfp360/"* ]] \
  || fail "El destino de copias no puede estar dentro de los datos originales."
[[ "$BACKUP_PASSPHRASE_FILE" =~ ^/[A-Za-z0-9_./-]+$ ]] \
  || fail "--backup-passphrase-file debe ser una ruta absoluta sin espacios ni caracteres especiales."
[[ "$BACKUP_MAX_AGE_HOURS" =~ ^[1-9][0-9]*$ ]] && ((BACKUP_MAX_AGE_HOURS <= 87600)) \
  || fail "--backup-max-age-hours debe ser un entero entre 1 y 87600."
[[ "$BACKUP_FREQUENCY" != *$'\n'* && "$BACKUP_FREQUENCY" != *$'\r'* ]] \
  || fail "--backup-frequency no puede contener saltos de línea."
command -v systemd-analyze >/dev/null 2>&1 \
  || fail "No encuentro systemd-analyze para validar la frecuencia de las copias."
systemd-analyze calendar "$BACKUP_FREQUENCY" >/dev/null \
  || fail "La frecuencia indicada en --backup-frequency no es válida para systemd."

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
git_repo() {
  git -c "safe.directory=$REPO_ROOT" -C "$REPO_ROOT" "$@"
}
git_repo rev-parse --show-toplevel >/dev/null 2>&1 \
  || fail "No encuentro un checkout Git del proyecto. Clona primero el repositorio."
[[ -f "$REPO_ROOT/pnpm-workspace.yaml" && -f "$REPO_ROOT/pnpm-lock.yaml" ]] \
  || fail "El checkout no parece ser la raíz de RED FP360."

if [[ ! -r /etc/os-release ]]; then
  fail "No puedo identificar la distribución del servidor."
fi
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "Solo se admite Ubuntu Server; se detectó ${ID:-desconocido}."
case "${VERSION_ID:-}" in
  22.04|24.04) ;;
  *) fail "Versión de Ubuntu no validada: ${VERSION_ID:-desconocida}. Usa Ubuntu 22.04 o 24.04 LTS; no actualizaré la distribución automáticamente." ;;
esac

[[ ! -e "$APP_DIR" ]] || fail "$APP_DIR ya existe. El instalador no sobrescribe una instalación."
[[ ! -e "$CONFIG_DIR" ]] || fail "$CONFIG_DIR ya existe. Revisa la configuración existente antes de continuar."
[[ ! -e /var/lib/redfp360 ]] || fail "/var/lib/redfp360 ya existe. El instalador no sobrescribirá datos existentes."
[[ ! -e "/etc/systemd/system/${SERVICE_NAME}.service" ]] \
  || fail "Ya existe el servicio ${SERVICE_NAME}; no se modificará."
for backup_unit in redfp360-backup.service redfp360-backup.timer; do
  [[ ! -e "/etc/systemd/system/${backup_unit}" ]] \
    || fail "Ya existe /etc/systemd/system/${backup_unit}; no se modificará."
done
if [[ -s /etc/caddy/Caddyfile ]] || systemctl is-active --quiet caddy 2>/dev/null; then
  fail "Ya existe una configuración/instancia de Caddy. El instalador no la sobrescribirá."
fi
if command -v pg_lsclusters >/dev/null 2>&1; then
  existing_clusters="$(pg_lsclusters --no-header 2>/dev/null || true)"
  [[ -z "${existing_clusters//[[:space:]]/}" ]] \
    || fail "Ya existe un clúster PostgreSQL. El instalador requiere un servidor PostgreSQL limpio y no lo reutilizará."
fi
if command -v ss >/dev/null 2>&1 && ss -ltnH | awk '$4 ~ /:(80|443)$/ { found=1 } END { exit !found }'; then
  fail "El puerto 80 o 443 ya está en uso. Libéralo o configura el proxy manualmente antes de instalar."
fi

if [[ -z "$DOMAIN" ]]; then
  read -r -p "Dominio DNS para RED FP360 (debe apuntar a este servidor): " DOMAIN
fi
[[ "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] \
  || fail "Escribe un dominio DNS completo válido; no se admite una IP ni localhost."
DOMAIN="${DOMAIN,,}"

if ((UPGRADE_SYSTEM)); then
  printf '\nSe ha solicitado actualizar los paquetes instalados del sistema.\n'
  printf 'Esto puede reiniciar servicios; no cambia la versión de Ubuntu ni reinicia el servidor.\n'
  read -r -p 'Escribe UPGRADE para confirmar: ' confirmation
  [[ "$confirmation" == "UPGRADE" ]] || fail "Actualización del sistema cancelada."
fi

if id "$SERVICE_USER" >/dev/null 2>&1; then
  fail "Ya existe el usuario de sistema $SERVICE_USER; comprueba si hay una instalación anterior."
fi

printf '\nInstalando requisitos del sistema. No se ejecutará una actualización general salvo que confirmes --upgrade-system.\n'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git gnupg openssl

if ((UPGRADE_SYSTEM)); then
  apt-get upgrade -y
fi

install -d -m 0755 /etc/apt/keyrings

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/redfp360-nodesource.gpg
chmod 0644 /etc/apt/keyrings/redfp360-nodesource.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/redfp360-nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main\n' \
  "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/redfp360-nodesource.list

curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor --yes -o /etc/apt/keyrings/redfp360-postgresql.gpg
chmod 0644 /etc/apt/keyrings/redfp360-postgresql.gpg
printf 'deb [signed-by=/etc/apt/keyrings/redfp360-postgresql.gpg] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' \
  "${VERSION_CODENAME:?No encuentro el codename de Ubuntu}" > /etc/apt/sources.list.d/redfp360-pgdg.list

curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/redfp360-caddy.gpg
chmod 0644 /etc/apt/keyrings/redfp360-caddy.gpg
printf 'deb [signed-by=/etc/apt/keyrings/redfp360-caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main\n' \
  > /etc/apt/sources.list.d/redfp360-caddy.list

apt-get update
apt-get install -y --no-install-recommends nodejs postgresql-16 postgresql-client-16 caddy
npm install --global pnpm@10.26.1

[[ "$(node --version)" == v24.* ]] || fail "Se esperaba Node.js 24; se encontró $(node --version)."
[[ "$(pnpm --version)" == "10.26.1" ]] || fail "No se pudo activar PNPM 10.26.1."
systemctl enable --now postgresql
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -qx 1; then
  fail "La base ${DB_NAME} ya existe; no se tocarán bases de datos existentes."
fi
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'" | grep -qx 1; then
  fail "El rol PostgreSQL ${DB_USER} ya existe; no se modificará."
fi

useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -m 0755 "$APP_DIR"
install -d -m 0750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"
if [[ ! -d "$BACKUP_DESTINATION" ]]; then
  install -d -m 0755 -o root -g root "$BACKUP_DESTINATION"
fi
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" \
  /var/lib/redfp360 "$DATA_DIR" "$DATA_DIR/private" \
  "$DATA_DIR/private/uploads" "$DATA_DIR/public"
chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

printf 'Copiando el commit %s al directorio de instalación...\n' "$(git_repo rev-parse --short HEAD)"
git_repo archive --format=tar HEAD | tar -xf - -C "$APP_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

DB_PASSWORD="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"
SETUP_TOKEN="$(openssl rand -hex 32)"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER} ENCODING 'UTF8';
SQL

cat > "$CONFIG_DIR/api.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
LOG_LEVEL=info
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
RED_FP360_SETUP_TOKEN=${SETUP_TOKEN}
RED_FP360_STORAGE_BACKEND=local
LOCAL_OBJECT_STORAGE_DIR=${DATA_DIR}
PUBLIC_OBJECT_SEARCH_PATHS=${DATA_DIR}/public
PUBLIC_BASE_URL=https://${DOMAIN}
ENV
chown root:root "$CONFIG_DIR/api.env"
chmod 0600 "$CONFIG_DIR/api.env"
cat > "$CONFIG_DIR/backup.env" <<BACKUP_ENV
RED_FP360_BACKUP_DESTINATION=${BACKUP_DESTINATION}
RED_FP360_BACKUP_PASSPHRASE_FILE=${BACKUP_PASSPHRASE_FILE}
RED_FP360_BACKUP_MAX_AGE_HOURS=${BACKUP_MAX_AGE_HOURS}
BACKUP_ENV
chown root:root "$CONFIG_DIR/backup.env"
chmod 0600 "$CONFIG_DIR/backup.env"
printf '%s\n' "$SETUP_TOKEN" > "$SETUP_TOKEN_FILE"
chmod 0600 "$SETUP_TOKEN_FILE"

printf '\nInstalando dependencias, generando el esquema inicial de la base vacía y compilando...\n'
runuser -u "$SERVICE_USER" -- env PORT=19362 BASE_PATH=/ pnpm --dir "$APP_DIR" install --frozen-lockfile
DB_INIT_ENV="$(mktemp /run/redfp360-db-init.XXXXXX)"
printf 'DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' \
  "$DB_USER" "$DB_PASSWORD" "$DB_NAME" > "$DB_INIT_ENV"
chown "$SERVICE_USER:$SERVICE_USER" "$DB_INIT_ENV"
chmod 0600 "$DB_INIT_ENV"
runuser -u "$SERVICE_USER" -- bash -c \
  'set -a; . "$1"; set +a; pnpm --dir "$2" --filter @workspace/db run push' \
  _ "$DB_INIT_ENV" "$APP_DIR"
rm -f "$DB_INIT_ENV"
runuser -u "$SERVICE_USER" -- env PORT=19362 BASE_PATH=/ pnpm --dir "$APP_DIR" run build

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=RED FP360 API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${CONFIG_DIR}/api.env
ExecStart=/usr/bin/node --enable-source-maps ${APP_DIR}/artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "/etc/systemd/system/${SERVICE_NAME}.service"

cat > /etc/systemd/system/redfp360-backup.service <<UNIT
[Unit]
Description=Crear copia cifrada coordinada de RED FP360
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
User=root
EnvironmentFile=${CONFIG_DIR}/backup.env
ExecStart=${APP_DIR}/scripts/backup-ubuntu.sh scheduled-backup --destination \${RED_FP360_BACKUP_DESTINATION} --passphrase-file \${RED_FP360_BACKUP_PASSPHRASE_FILE} --status-file /var/lib/redfp360/backup-status --max-age-hours \${RED_FP360_BACKUP_MAX_AGE_HOURS}
UNIT
chmod 0644 /etc/systemd/system/redfp360-backup.service

cat > /etc/systemd/system/redfp360-backup.timer <<UNIT
[Unit]
Description=Programar copias cifradas de RED FP360

[Timer]
OnCalendar=${BACKUP_FREQUENCY}
Persistent=true
AccuracySec=1min
Unit=redfp360-backup.service

[Install]
WantedBy=timers.target
UNIT
chmod 0644 /etc/systemd/system/redfp360-backup.timer

cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
	encode zstd gzip
	@api path /api /api/*
	handle @api {
		reverse_proxy 127.0.0.1:8080
	}
	handle {
		root * ${APP_DIR}/artifacts/red-fp360/dist/public
		try_files {path} /index.html
		file_server
	}
}
CADDY
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8080/api/healthz >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" -eq 1 ]] || fail "La API no pasó /api/healthz. Revisa: journalctl -u ${SERVICE_NAME}."

systemctl enable --now redfp360-backup.timer
systemctl enable --now caddy
systemctl reload caddy

cat <<DONE

RED FP360 quedó instalada en ${APP_DIR}.
Web: https://${DOMAIN}
Salud API: https://${DOMAIN}/api/healthz

El token de configuración inicial está en ${SETUP_TOKEN_FILE} (solo root puede leerlo).
Completa el alta inicial del administrador y ejecuta:
  sudo ${APP_DIR}/scripts/finalize-ubuntu-setup.sh

Los documentos privados se guardan en ${DATA_DIR}; inclúyelos en las copias de
seguridad junto con PostgreSQL. Se ha programado una copia ${BACKUP_FREQUENCY}
en ${BACKUP_DESTINATION}; monta el almacenamiento externo y crea el archivo de
frase secreta indicado en ${BACKUP_PASSPHRASE_FILE}. Para configurar y comprobar
la copia y realizar un ensayo de restauración, consulta ${APP_DIR}/docs/ubuntu-backups.md. Abre los puertos 80 y
443 en el firewall de red;
el instalador no modifica el firewall ni reinicia el host.
La autonomía usa un único proceso API en esta instalación.
DONE
