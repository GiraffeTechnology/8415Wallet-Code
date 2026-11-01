#!/usr/bin/env bash
# Original hosted-Linux TEST_ONLY SQL fixture; no production DB or credentials.
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == Linux && $(uname -s) == Linux ]] || {
  echo "RECEIPT_SQL_REQUIRES_EXISTING_LINUX_CI" >&2; exit 1;
}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
EVIDENCE="$ROOT/dist/receipt-sql-ci-evidence"
mkdir -p "$EVIDENCE"
WORK=$(mktemp -d "$ROOT/.receipt-sql-ci.XXXXXX")
on_exit() {
  status=$?
  printf '{"exit":%s,"scope":"SIMULATED_REGISTRY_SOFTWARE_TEST_ONLY"}\n' "$status" > "$EVIDENCE/exit.json"
}
trap on_exit EXIT
exec > >(tee "$EVIDENCE/run.raw.log") 2>&1
for tool in node go docker git python3 openssl; do
  command -v "$tool" >/dev/null || { echo "RECEIPT_SQL_EXISTING_TOOL_MISSING:$tool" >&2; exit 1; }
done
export GOTOOLCHAIN=local CGO_ENABLED=0
node --version
go version
docker compose version
SOURCE_COMMIT=0403388645cdd799a0899e00b734718bcf1b3297
mkdir "$WORK/source"
SOURCE="$WORK/source"
export GIT_TERMINAL_PROMPT=0
git -C "$SOURCE" init --quiet
git -C "$SOURCE" fetch --quiet --depth=1 https://github.com/GiraffeTechnology/ArtFi.git "$SOURCE_COMMIT"
git -C "$SOURCE" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$SOURCE_COMMIT"
test "$(git -C "$SOURCE" rev-parse 'HEAD^{tree}')" = c9d377646f41f1464db9182c957ae323b5a56b7c
python3 -I -B - "$SOURCE" "$EVIDENCE/source-pins.json" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
expected={
 'apps/api/internal/httpapi/nft_operation_store.go':'2e97281c3471f23e8f711c1538ffd4acb40e18d8d3db4c2fa73155876a281f82',
 'apps/api/cmd/task-journal-software-test/main.go':'74eadb906fe364d34a5bb5459ec9260b5b5f39633d39376ed61fdc6a27332711',
 'scripts/agent/test-mysql-docker.sh':'68ab762a4d1cd5c93156d79a98617d3d322914af622a2850640308a5e6412b29',
 'apps/api/internal/httpapi/testdata/oracle-simulated-registry/test/fixtures/simulated-registry-v1.json':'154b15a85d9cdeed41138a8f77981521f778db7f97d54fbc9f221cb471c1fb3c',
}
actual={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in expected}
if actual!=expected:raise SystemExit('RECEIPT_SQL_ORIGINAL_SOURCE_HASH_MISMATCH')
pathlib.Path(sys.argv[2]).write_text(json.dumps({'commit':'0403388645cdd799a0899e00b734718bcf1b3297','sha256':actual},indent=2)+'\n')
PY
HOST="$WORK/artfi-task-journal-software-test"
(
  cd "$SOURCE/apps/api"
  go build -mod=readonly -trimpath -ldflags="-s -w" -o "$HOST" ./cmd/task-journal-software-test
)
sha256sum "$HOST" | tee "$EVIDENCE/host-sha256.txt"
"$HOST" --help
export ARTFI_RECEIPT_SOFTWARE_HOST="$HOST"
export ARTFI_RECEIPT_SOFTWARE_SOURCE="$SOURCE/apps/api/internal/httpapi/testdata/oracle-simulated-registry"
bash "$SOURCE/scripts/agent/test-mysql-docker.sh" --client \
  node --conditions=react-server "$ROOT/tests/whole-receipt-sql-client.mjs"
