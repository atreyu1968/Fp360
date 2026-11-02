"""Sandboxed updater control-flow tests; never touch the real host installation.

System services, GitHub, builds and backups are simulated. These tests do not
replace installation/recovery verification on a real Ubuntu server.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "update-ubuntu.sh"
OLD_COMMIT = "a" * 40
NEW_COMMIT = "b" * 40


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="redfp360-updater-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "opt/redfp360"
        self.data = self.root / "var/lib/redfp360"
        self.config = self.root / "etc/redfp360"
        self.fixture = self.root / "fixture"
        self.bin = self.root / "bin"
        for path in (self.app, self.data / "objects", self.config,
                     self.fixture, self.bin, self.root / "run/lock",
                     self.root / "backups"):
            path.mkdir(parents=True, exist_ok=True)
        for base in (self.app, self.fixture):
            (base / "lib/db/src/schema").mkdir(parents=True)
            (base / "lib/db/src/schema/index.ts").write_text("same schema")
            (base / "lib/db/drizzle.config.ts").write_text("same config")
            (base / "pnpm-workspace.yaml").write_text("packages: []")
        (self.app / "old-marker").touch()
        (self.fixture / "new-marker").touch()
        (self.data / "objects/document").write_text("keep this document")
        (self.data / "release").write_text(OLD_COMMIT + "\n")
        (self.root / "running").touch()
        (self.root / "passphrase").write_text("fictional test fixture only")
        (self.config / "backup.env").write_text(
            f"RED_FP360_BACKUP_DESTINATION={self.root}/backups\n"
            f"RED_FP360_BACKUP_PASSPHRASE_FILE={self.root}/passphrase\n"
        )
        (self.app / "scripts").mkdir()
        self.executable(self.app / "scripts/backup-ubuntu.sh", """
echo backup >> "$TEST_EVENTS"
[[ "$TEST_SCENARIO" != backup-fail ]]
""")
        self.executable(self.bin / "git", """
if [[ "$1" == clone ]]; then
  cp -a "$TEST_FIXTURE" "${@: -1}"
elif [[ "$1" == -C ]]; then
  printf '%s\\n' "$TEST_NEW_COMMIT"
fi
""")
        self.executable(self.bin / "runuser", """
while (($#)); do
  if [[ "$1" == -- ]]; then shift; exec "$@"; fi
  shift
done
exit 1
""")
        self.executable(self.bin / "stat", """
case "$2" in
  '%u') echo 0 ;;
  '%a') echo 600 ;;
  *) exit 1 ;;
esac
""")
        for command in ("id", "chown", "mountpoint", "sleep"):
            self.executable(self.bin / command, "exit 0\n")
        self.executable(self.bin / "pnpm", """
echo build >> "$TEST_EVENTS"
[[ "$TEST_SCENARIO" != build-fail ]]
""")
        self.executable(self.bin / "systemctl", """
echo "$*" >> "$TEST_EVENTS"
case "$1" in
  is-active) [[ -f "$TEST_ROOT/running" ]] ;;
  stop) rm -f "$TEST_ROOT/running" ;;
  start)
    if [[ "$TEST_SCENARIO" == start-fail && -f "$TEST_APP/new-marker" ]]; then
      exit 1
    fi
    touch "$TEST_ROOT/running"
    ;;
  *) exit 1 ;;
esac
""")
        self.executable(self.bin / "curl", """
if [[ "$TEST_SCENARIO" == health-fail && -f "$TEST_APP/new-marker" ]]; then
  exit 22
fi
[[ -f "$TEST_ROOT/running" ]]
""")
        # Rewrite fixed host paths only in this temporary copy, not in production.
        source = SOURCE.read_text().replace('[[ "${EUID}" -eq 0 ]]', "true")
        for prefix in ("/opt", "/etc/redfp360", "/var/lib/redfp360", "/run/lock"):
            source = source.replace(prefix, str(self.root) + prefix)
        self.script = self.root / "updater.sh"
        self.script.write_text(source)
        self.events = self.root / "events"

    @staticmethod
    def executable(path, body):
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body)
        path.chmod(0o755)

    def run_update(self, scenario="success"):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                   TEST_SCENARIO=scenario, TEST_ROOT=str(self.root),
                   TEST_APP=str(self.app), TEST_FIXTURE=str(self.fixture),
                   TEST_EVENTS=str(self.events), TEST_NEW_COMMIT=NEW_COMMIT)
        return subprocess.run(["bash", str(self.script)], env=env,
                              stdin=subprocess.DEVNULL, capture_output=True,
                              text=True, timeout=15)

    def assert_old_untouched(self):
        self.assertTrue((self.app / "old-marker").exists())
        self.assertEqual((self.data / "release").read_text().strip(), OLD_COMMIT)
        self.assertEqual((self.data / "objects/document").read_text(),
                         "keep this document")
        self.assertTrue((self.root / "running").exists())

    def test_success_keeps_previous_code_and_documents(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.app / "new-marker").exists())
        previous = list((self.root / "opt").glob("redfp360.rollback.*"))
        self.assertEqual(len(previous), 1)
        self.assertTrue((previous[0] / "old-marker").exists())
        self.assertEqual((self.data / "release").read_text().strip(), NEW_COMMIT)
        self.assertEqual((self.data / "objects/document").read_text(),
                         "keep this document")
        self.assertIn("backup", self.events.read_text())

    def test_schema_change_stops_before_backup_or_deployment(self):
        (self.fixture / "lib/db/src/schema/index.ts").write_text("changed")
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_untouched()
        self.assertNotIn("backup", self.events.read_text())

    def test_build_failure_leaves_old_installation(self):
        result = self.run_update("build-fail")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_untouched()
        self.assertNotIn("backup", self.events.read_text())

    def test_backup_failure_prevents_deployment(self):
        result = self.run_update("backup-fail")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_untouched()

    def test_start_failure_restores_previous_code(self):
        result = self.run_update("start-fail")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_untouched()
        self.assertIn("restauró automáticamente", result.stderr)

    def test_health_failure_restores_previous_code(self):
        result = self.run_update("health-fail")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_untouched()
        self.assertIn("restauró automáticamente", result.stderr)

    def test_same_release_does_not_backup_build_or_restart(self):
        (self.data / "release").write_text(NEW_COMMIT + "\n")
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("backup", self.events.read_text())
        self.assertNotIn("build", self.events.read_text())
        self.assertNotIn("stop", self.events.read_text())


if __name__ == "__main__":
    unittest.main()
