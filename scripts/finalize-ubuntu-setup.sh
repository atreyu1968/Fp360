#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/redfp360/api.env"
TOKEN_FILE="/root/redfp360-setup-token"

[[ "${EUID}" -eq 0 ]] || { echo "Ejecuta este comando con sudo." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "No encuentro $ENV_FILE." >&2; exit 1; }
grep -q '^RED_FP360_SETUP_TOKEN=' "$ENV_FILE" || {
  echo "El token de configuración ya fue retirado."
  exit 0
}

temporary_file="$(mktemp /etc/redfp360/api.env.XXXXXX)"
trap 'rm -f "$temporary_file"' EXIT
sed '/^RED_FP360_SETUP_TOKEN=/d' "$ENV_FILE" > "$temporary_file"
chown root:root "$temporary_file"
chmod 0600 "$temporary_file"
mv "$temporary_file" "$ENV_FILE"
rm -f "$TOKEN_FILE"
systemctl restart redfp360
echo "Token inicial retirado y API reiniciada."
