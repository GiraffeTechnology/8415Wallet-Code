#!/usr/bin/env bash
# Original hosted-Linux TEST_ONLY SQL fixture; no production DB or credentials.
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == Linux && $(uname -s) == Linux ]] || {
  echo "RECEIPT_SQL_REQUIRES_EXISTING_LINUX_CI" >&2; exit 1;
}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
CLIENT=tests/whole-receipt-v2-sql-client.mjs
EVIDENCE_NAME=receipt-v2-sql-ci-evidence
(( $# == 0 )) || { echo RECEIPT_V2_CLIENT_ARGUMENT_REFUSED >&2; exit 1; }
EVIDENCE="$ROOT/dist/$EVIDENCE_NAME"
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
SOURCE_COMMIT=5511600321940c763e85def24d8a8ee08f2837d8
mkdir "$WORK/source"
SOURCE="$WORK/source"
export GIT_TERMINAL_PROMPT=0
git -C "$SOURCE" init --quiet
git -C "$SOURCE" fetch --quiet --depth=1 https://github.com/GiraffeTechnology/ArtFi.git "$SOURCE_COMMIT"
git -C "$SOURCE" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$SOURCE_COMMIT"
test "$(git -C "$SOURCE" rev-parse 'HEAD^{tree}')" = a5e67adc017736ea216f70b76497e0960b360ab3
python3 -I -B - "$SOURCE" "$EVIDENCE/source-pins.json" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
expected={'apps/api/cmd/task-journal-software-test/main.go': 'fbc67292c9cd6b1e14caaef0c9c5f8c6fc5dda04c926daf9211c5698b9f94a42', 'apps/api/internal/httpapi/nft_simulated_registry_authority.go': 'b9f5df80792b7350b8de926245b72a02e4d5821c007de4047c32959fca9d3360', 'apps/api/internal/httpapi/testdata/oracle-simulated-registry-v2/registry-driver.mjs': '527d63f86e7deb17351d090c1c757ec410f372b65ba7a6f39975fcf976c7eb93', 'apps/api/internal/httpapi/testdata/oracle-simulated-registry-v2/rpc-read-check.mjs': 'bd013cdaba18e2349c1013e6777796671653ba69d9683c4bf25bdeafc9842d1c', 'scripts/agent/test-mysql-docker.sh': '0cd2e55af417ce0a30895b01a19d33c2900f0abad7c670a2cbafc78cfb08c853', 'apps/api/internal/httpapi/testdata/oracle-simulated-registry-v2/test/fixtures/simulated-registry-v2.json': '0d61e9a57d0e882f5be806a371db37f03f96d3db8dd97473d6fd364ff1704b82', 'apps/api/internal/httpapi/nft_operation_store.go': '2e97281c3471f23e8f711c1538ffd4acb40e18d8d3db4c2fa73155876a281f82'}
actual={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in expected}
if actual!=expected:raise SystemExit('RECEIPT_SQL_ORIGINAL_SOURCE_HASH_MISMATCH')
pathlib.Path(sys.argv[2]).write_text(json.dumps({'commit':'5511600321940c763e85def24d8a8ee08f2837d8','sha256':actual},indent=2)+'\n')
PY
HOST="$WORK/artfi-task-journal-software-test"
(
  cd "$SOURCE/apps/api"
  go build -mod=readonly -trimpath -ldflags="-s -w" -o "$HOST" ./cmd/task-journal-software-test
)
sha256sum "$HOST" | tee "$EVIDENCE/host-sha256.txt"
"$HOST" --help
export ARTFI_RECEIPT_SOFTWARE_HOST="$HOST"
export ARTFI_RECEIPT_SOFTWARE_SOURCE="$SOURCE/apps/api/internal/httpapi/testdata/oracle-simulated-registry-v2"
bash "$SOURCE/scripts/agent/test-mysql-docker.sh" --client \
  node --conditions=react-server "$ROOT/$CLIENT"
