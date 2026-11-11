#!/usr/bin/env bash
# OWASP ZAP baseline scan (spider + PASSIVE rules only: it sends ordinary GET requests, no attacks).
#
#   scripts/security/zap-baseline.sh --target http://localhost --out zap-report [--fail-on warn|fail] [--minutes 2]
#
# Writes zap.html, zap.json and zap.md into --out. Rules we deliberately accept (or insist on) are in
# scripts/security/zap-rules.tsv, one comment per rule.
#
# --fail-on fail  (default) fail only when an alert of a rule configured as FAIL in zap-rules.tsv appears
# --fail-on warn  also fail on any WARN alert
#
# Exit codes: 0 pass, 1 findings per --fail-on, 2 usage or environment problem (docker missing...), 3 ZAP did not complete.
#
# Needs Docker. Run it ONLY against the audit test stack (localhost, a private/tailnet address, a single-label host name);
# a public-looking host is refused unless ZAP_ALLOW_REMOTE=1. `--network host` reaches the host's localhost on Linux (CI and
# the Docker host); on Docker Desktop (Windows/macOS) use the host's LAN address as --target instead.
#
# The unauthenticated crawl sees the public pages only (login, register, landing). Authenticated API coverage comes from
# scripts/security/rbac-live.mjs and the manual cases of docs/SECURITY_AUDIT_PLAN.md.

set -euo pipefail

# ZAP version: bump this ONE line when the pull of the pinned image fails or a newer release is wanted.
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.15.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES_FILE="${ZAP_RULES_FILE:-$SCRIPT_DIR/zap-rules.tsv}"

usage() {
  sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

TARGET=""
OUT="zap-report"
FAIL_ON="fail"
MINUTES="2"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)  TARGET="${2:-}"; shift 2 ;;
    --out)     OUT="${2:-}"; shift 2 ;;
    --fail-on) FAIL_ON="${2:-}"; shift 2 ;;
    --minutes) MINUTES="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "ERROR: --target is required, for example --target http://localhost" >&2
  exit 2
fi
if [[ ! "$TARGET" =~ ^https?://[^/[:space:]]+ ]]; then
  echo "ERROR: --target must be an http(s) URL (got: $TARGET)" >&2
  exit 2
fi
if [[ "$FAIL_ON" != "warn" && "$FAIL_ON" != "fail" ]]; then
  echo "ERROR: --fail-on must be 'warn' or 'fail' (got: $FAIL_ON)" >&2
  exit 2
fi
if [[ ! "$MINUTES" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --minutes must be a whole number (got: $MINUTES)" >&2
  exit 2
fi
if [[ ! -f "$RULES_FILE" ]]; then
  echo "ERROR: rule file not found: $RULES_FILE" >&2
  exit 2
fi

# ---- only the audit test stack ------------------------------------------------------------------------------------
HOST="${TARGET#*://}"
HOST="${HOST%%/*}"
HOST="${HOST##*@}"
if [[ "$HOST" == \[* ]]; then HOST="${HOST%%]*}]"; else HOST="${HOST%%:*}"; fi
HOST="$(printf '%s' "$HOST" | tr '[:upper:]' '[:lower:]')"
is_test_host() {
  local h="$1"
  case "$h" in
    localhost|"[::1]"|127.*|10.*|192.168.*|169.254.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;; # Tailscale 100.64.0.0/10
    *.local|*.localhost|*.internal|*.lan|*.test|*.ts.net) return 0 ;;
  esac
  [[ "$h" != *.* && "$h" != *:* ]] && return 0 # single label: a tailnet machine name such as atreya-2
  return 1
}
if ! is_test_host "$HOST" && [[ "${ZAP_ALLOW_REMOTE:-0}" != "1" ]]; then
  echo "ERROR: refusing to scan '$HOST': it does not look like a test stack (localhost, private or tailnet address, single-label name)." >&2
  echo "       Scan only systems you own and that carry test data. Set ZAP_ALLOW_REMOTE=1 to override." >&2
  exit 2
fi

# ---- docker --------------------------------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed or not on PATH. The ZAP baseline runs as the container image $ZAP_IMAGE." >&2
  echo "       Run this script on the Docker host (for example atreya-2) or in the GitHub workflow, not on a machine without Docker." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker is installed but the daemon is not reachable (is it running, and may this user use it?)." >&2
  exit 2
fi

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cp "$RULES_FILE" "$OUT/zap-rules.tsv"
# The container's zap user (uid 1000) must be able to write the reports into the mounted folder
chmod a+rwx "$OUT"

echo "ZAP baseline: target=$TARGET out=$OUT fail-on=$FAIL_ON spider=${MINUTES}m image=$ZAP_IMAGE"

# ZAP exit codes: 0 clean, 1 at least one FAIL alert, 2 at least one WARN alert (no FAIL), 3 the scan itself failed.
# We do not pass -I (which turns warnings into exit 0) so that --fail-on can decide.
set +e
docker run --rm --network host \
  -v "$OUT":/zap/wrk:rw \
  "$ZAP_IMAGE" zap-baseline.py \
  -t "$TARGET" \
  -c zap-rules.tsv \
  -r zap.html -J zap.json -w zap.md \
  -m "$MINUTES"
RC=$?
set -e

# ---- summary of the alerts ----------------------------------------------------------------------------------------
if [[ -f "$OUT/zap.json" ]] && command -v node >/dev/null 2>&1; then
  node - "$OUT/zap.json" <<'NODE' || true
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const alerts = (report.site || []).flatMap((s) => s.alerts || []);
console.log(`\nZAP alerts: ${alerts.length}`);
for (const a of alerts) console.log(`  ${String(a.riskdesc || '').padEnd(24)} ${a.pluginid}  ${a.alert}  (${a.count} instance(s))`);
NODE
fi

case "$RC" in
  0)
    echo "PASS: no alerts (reports in $OUT)"
    exit 0
    ;;
  1)
    echo "FAIL: at least one alert of a rule set to FAIL in zap-rules.tsv (reports in $OUT)" >&2
    exit 1
    ;;
  2)
    if [[ "$FAIL_ON" == "warn" ]]; then
      echo "FAIL: warnings present and --fail-on warn (reports in $OUT)" >&2
      exit 1
    fi
    echo "PASS: warnings only, --fail-on fail (read $OUT/zap.md and decide which to accept in zap-rules.tsv)"
    exit 0
    ;;
  *)
    echo "ERROR: the ZAP baseline did not complete (exit $RC). Is $TARGET reachable from the container?" >&2
    exit 3
    ;;
esac
