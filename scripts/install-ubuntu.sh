#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="/opt/redfp360"
CONFIG_DIR="/etc/redfp360"
DB_NAME="redfp360"
DB_USER="redfp360"
SERVICE_USER="redfp360"
SERVICE_NAME="redfp360"
SETUP_TOKEN_FILE="/root/redfp360-setup-token"
UPGRADE_SYSTEM=0
DOMAIN=""
GCS_BUCKET=""
GCS_KEY_FILE=""

usage() {
  cat <<'USAGE'
Instala RED FP360 en un Ubuntu Server limpio a partir de un checkout de GitHub.

Uso:
  sudo bash scripts/install-ubuntu.sh [opciones]

Opciones:
  --domain DOMINIO       Dominio DNS que apunta a este servidor (TLS por Caddy)
  --bucket NOMBRE        Bucket privado de Google Cloud Storage ya creado
  --gcs-key RUTA         JSON de cuenta de servicio, fuera del repositorio
  --upgrade-system       Ofrece una actualización APT general, con confirmación
  --help                 Muestra esta ayuda

No borra ni reemplaza instalaciones existentes. El checkout debe contener
pnpm-workspace.yaml y .git. Para obtenerlo primero, consulta la sección
"Instalación en Ubuntu desde GitHub" del README.
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
    --bucket)
      (($# >= 2)) || fail "--bucket necesita un valor."
      GCS_BUCKET="$2"; shift 2 ;;
    --gcs-key)
      (($# >= 2)) || fail "--gcs-key necesita una ruta."
      GCS_KEY_FILE="$2"; shift 2 ;;
    --upgrade-system) UPGRADE_SYSTEM=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Opción desconocida: $1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "Ejecuta el instalador con sudo."

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
[[ ! -e "/etc/systemd/system/${SERVICE_NAME}.service" ]] \
  || fail "Ya existe el servicio ${SERVICE_NAME}; no se modificará."
if [[ -s /etc/caddy/Caddyfile ]] || systemctl is-active --quiet caddy 2>/dev/null; then
  fail "Ya existe una configuración/instancia de Caddy. El instalador no la sobrescribirá."
fi
if command -v pg_lsclusters >/dev/null 2>&1 && pg_lsclusters --no-header | grep -q .; then
  fail "Ya existe un clúster PostgreSQL. El instalador requiere un servidor PostgreSQL limpio y no lo reutilizará."
fi
if command -v ss >/dev/null 2>&1 && ss -ltn | grep -Eq ':(80|443)[[:space:]]'; then
  fail "El puerto 80 o 443 ya está en uso. Libéralo o configura el proxy manualmente antes de instalar."
fi

if [[ -z "$DOMAIN" ]]; then
  read -r -p "Dominio DNS para RED FP360 (debe apuntar a este servidor): " DOMAIN
fi
[[ "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] \
  || fail "Escribe un dominio DNS completo válido; no se admite una IP ni localhost."
DOMAIN="${DOMAIN,,}"

if [[ -z "$GCS_BUCKET" ]]; then
  read -r -p "Nombre del bucket privado de Google Cloud Storage ya creado: " GCS_BUCKET
fi
[[ "$GCS_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] \
  || fail "El nombre del bucket debe tener entre 3 y 63 letras minúsculas, números o guiones."

if [[ -z "$GCS_KEY_FILE" ]]; then
  read -r -p "Ruta al JSON de cuenta de servicio GCS (no pegues su contenido): " GCS_KEY_FILE
fi
[[ "$GCS_KEY_FILE" = /* && -f "$GCS_KEY_FILE" && -r "$GCS_KEY_FILE" ]] \
  || fail "La ruta de credenciales debe ser un archivo JSON legible con ruta absoluta."
case "$GCS_KEY_FILE" in
  "$REPO_ROOT"/*) fail "Guarda el JSON fuera del checkout para evitar incluir credenciales en el repositorio." ;;
esac

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
apt-get install -y --no-install-recommends ca-certificates curl git gnupg jq openssl

if ((UPGRADE_SYSTEM)); then
  apt-get upgrade -y
fi

install -d -m 0755 /etc/apt/keyrings

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod 0644 /etc/apt/keyrings/nodesource.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main\n' \
  "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/nodesource.list

curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor --yes -o /etc/apt/keyrings/postgresql.gpg
chmod 0644 /etc/apt/keyrings/postgresql.gpg
printf 'deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' \
  "${VERSION_CODENAME:?No encuentro el codename de Ubuntu}" > /etc/apt/sources.list.d/pgdg.list

curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable.gpg
chmod 0644 /etc/apt/keyrings/caddy-stable.gpg
printf 'deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main\n' \
  > /etc/apt/sources.list.d/caddy-stable.list

apt-get update
apt-get install -y --no-install-recommends nodejs postgresql-16 postgresql-client-16 caddy
npm install --global pnpm@10.26.1

[[ "$(node --version)" == v24.* ]] || fail "Se esperaba Node.js 24; se encontró $(node --version)."
[[ "$(pnpm --version)" == "10.26.1" ]] || fail "No se pudo activar PNPM 10.26.1."
jq -e '.type == "service_account" and (.private_key | type == "string")' "$GCS_KEY_FILE" >/dev/null \
  || fail "El JSON no parece una credencial de cuenta de servicio de Google Cloud."

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

install -o root -g "$SERVICE_USER" -m 0640 "$GCS_KEY_FILE" "$CONFIG_DIR/google-service-account.json"
cat > "$CONFIG_DIR/api.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
LOG_LEVEL=info
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
RED_FP360_SETUP_TOKEN=${SETUP_TOKEN}
RED_FP360_STORAGE_BACKEND=gcs
GOOGLE_APPLICATION_CREDENTIALS=${CONFIG_DIR}/google-service-account.json
PRIVATE_OBJECT_DIR=/${GCS_BUCKET}/private
PUBLIC_OBJECT_SEARCH_PATHS=/${GCS_BUCKET}/public
ENV
chown root:root "$CONFIG_DIR/api.env"
chmod 0600 "$CONFIG_DIR/api.env"
printf '%s\n' "$SETUP_TOKEN" > "$SETUP_TOKEN_FILE"
chmod 0600 "$SETUP_TOKEN_FILE"

cat > "$CONFIG_DIR/gcs-cors.json" <<CORS
[
  {
    "origin": ["https://${DOMAIN}"],
    "method": ["GET", "HEAD", "PUT"],
    "responseHeader": ["Content-Type", "Content-Length", "ETag"],
    "maxAgeSeconds": 3600
  }
]
CORS
chmod 0640 "$CONFIG_DIR/gcs-cors.json"

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

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "/etc/systemd/system/${SERVICE_NAME}.service"

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

systemctl enable --now caddy
systemctl reload caddy

cat <<DONE

RED FP360 quedó instalada en ${APP_DIR}.
Web: https://${DOMAIN}
Salud API: https://${DOMAIN}/api/healthz

El token de configuración inicial está en ${SETUP_TOKEN_FILE} (solo root puede leerlo).
Completa el alta inicial del administrador y ejecuta:
  sudo ${APP_DIR}/scripts/finalize-ubuntu-setup.sh

Antes de permitir cargas, configura el CORS del bucket según:
  ${CONFIG_DIR}/gcs-cors.json
No reemplaces reglas CORS existentes sin revisarlas. Abre los puertos 80 y 443
en el firewall de red; el instalador no modifica el firewall ni reinicia el host.
La autonomía usa un único proceso API en esta instalación.
DONE
