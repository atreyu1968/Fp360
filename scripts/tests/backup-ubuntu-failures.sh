#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-ubuntu.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/mock-bin"

cat > "$TEST_ROOT/mock-command" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
command_name="${0##*/}"
case "$command_name" in
  systemctl)
    action="${1:-}"
    service="${2:-}"
    case "$action:$service" in
      is-active:postgresql) exit 0 ;;
      is-active:redfp360) [[ "$(cat "$MOCK_ACTIVE_FILE")" == active ]] ;;
      stop:redfp360) printf inactive > "$MOCK_ACTIVE_FILE" ;;
      start:redfp360) printf active > "$MOCK_ACTIVE_FILE" ;;
      *) printf 'unexpected systemctl call: %s\n' "$*" >&2; exit 90 ;;
    esac
    ;;
  findmnt) printf '/mnt/mock-backup\n' ;;
  stat)
    format="${1:-}"
    case "$format" in
      -c)
        case "${2:-}" in
          %u) printf '0\n' ;;
          %a) printf '600\n' ;;
          %u:%a) printf '0:700\n' ;;
          *) printf 'unexpected stat format: %s\n' "${2:-}" >&2; exit 90 ;;
        esac
        ;;
      *) printf 'unexpected stat call: %s\n' "$*" >&2; exit 90 ;;
    esac
    ;;
  install)
    destination="${@: -1}"
    mkdir -p -- "$destination"
    chmod 0700 -- "$destination"
    ;;
  runuser)
    shift 3
    "$@"
    ;;
  pg_dump)
    if [[ "${1:-}" == --version ]]; then
      printf 'pg_dump mock 1.0\n'
      exit 0
    fi
    if [[ "${BACKUP_FAIL_STAGE:-}" == pg_dump ]]; then
      printf 'partial dump\n'
      exit 42
    fi
    printf 'database dump\n'
    ;;
  tar)
    output=""
    for ((index = 1; index < $#; index++)); do
      case "${!index}" in
        -cf|-czf) next=$((index + 1)); output="${!next}" ;;
      esac
    done
    [[ -n "$output" ]] || { printf 'missing tar output path\n' >&2; exit 90; }
    printf 'partial archive\n' > "$output"
    if [[ "${BACKUP_FAIL_STAGE:-}" == package && "$*" == *" -czf "* ]]; then
      exit 42
    fi
    ;;
  gpg)
    output=""
    while (($#)); do
      if [[ "$1" == --output ]]; then
        output="$2"
        shift 2
      else
        shift
      fi
    done
    [[ -n "$output" ]] || { printf 'missing gpg output path\n' >&2; exit 90; }
    printf 'partial encrypted archive\n' > "$output"
    [[ "${BACKUP_FAIL_STAGE:-}" != encrypt ]] || exit 42
    ;;
  *) printf 'unsupported mock command: %s\n' "$command_name" >&2; exit 90 ;;
esac
MOCK
chmod 0700 "$TEST_ROOT/mock-command"
for command_name in systemctl findmnt stat install runuser pg_dump tar gpg; do
  ln -s "$TEST_ROOT/mock-command" "$TEST_ROOT/mock-bin/$command_name"
done

run_failure_case() {
  local stage="$1" case_root="$TEST_ROOT/$1" status
  mkdir -p "$case_root/destination" "$case_root/tmp" "$case_root/objects/private/uploads"
  : > "$case_root/passphrase"
  printf active > "$case_root/api-state"

  set +e
  BACKUP_SCRIPT="$BACKUP_SCRIPT" \
    PATH="$TEST_ROOT/mock-bin:$PATH" \
    TMPDIR="$case_root/tmp" \
    MOCK_ACTIVE_FILE="$case_root/api-state" \
    BACKUP_FAIL_STAGE="$stage" \
    BACKUP_CASE_ROOT="$case_root" \
    bash -c '
      source "$BACKUP_SCRIPT"
      require_root() { :; }
      OBJECT_ROOT="$BACKUP_CASE_ROOT/objects"
      backup --destination "$BACKUP_CASE_ROOT/destination" --passphrase-file "$BACKUP_CASE_ROOT/passphrase"
    ' _ 2>"$case_root/stderr"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || { printf 'FAIL: %s failure unexpectedly succeeded\n' "$stage" >&2; return 1; }
  [[ "$(cat "$case_root/api-state")" == active ]] \
    || { printf 'FAIL: API was not active after %s failure\n' "$stage" >&2; cat "$case_root/stderr" >&2; return 1; }
  [[ -z "$(find "$case_root/destination/redfp360" -maxdepth 1 -type f -print 2>/dev/null)" ]] \
    || { printf 'FAIL: archive/staged file remained after %s failure\n' "$stage" >&2; return 1; }
  [[ -z "$(find "$case_root/tmp" -mindepth 1 -print -quit)" ]] \
    || { printf 'FAIL: temporary work files remained after %s failure\n' "$stage" >&2; return 1; }
  printf 'PASS: %s failure restarted the API and left no archive or temporary work files\n' "$stage"
}

for stage in pg_dump package encrypt; do
  run_failure_case "$stage"
done
