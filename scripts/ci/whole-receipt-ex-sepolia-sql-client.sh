#!/usr/bin/env bash
# Original hosted-Linux TEST_ONLY SQL fixture; no production DB or credentials.
set -euo pipefail
[[ ${CI:-} == true && ${RUNNER_OS:-} == Linux && $(uname -s) == Linux ]] || {
  echo "RECEIPT_SQL_REQUIRES_EXISTING_LINUX_CI" >&2; exit 1;
}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
EVIDENCE="$ROOT/dist/receipt-ex-sql-ci-evidence"
mkdir -p "$EVIDENCE"
WORK=$(mktemp -d "$ROOT/.receipt-ex-sql-ci.XXXXXX")
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
SOURCE_COMMIT=e007fad8682d48d52fcde321b6c273a94a2715c5
mkdir "$WORK/source"
SOURCE="$WORK/source"
export GIT_TERMINAL_PROMPT=0
git -C "$SOURCE" init --quiet
git -C "$SOURCE" fetch --quiet --depth=1 https://github.com/GiraffeTechnology/ArtFi.git "$SOURCE_COMMIT"
git -C "$SOURCE" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$SOURCE_COMMIT"
test "$(git -C "$SOURCE" rev-parse 'HEAD^{tree}')" = b23affaa67ea5e7e447911c1063e725bd39450a1
python3 -I -B - "$SOURCE" "$EVIDENCE/source-pins.json" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
expected={
 'apps/api/internal/httpapi/testdata/oracle-simulated-registry/registry-driver.mjs':'0d40313be43832deb40a2c7b9bcaad41694b9526ba15279e7350774f2ae809a1',
 'apps/api/internal/httpapi/nft_operation_store.go':'2e97281c3471f23e8f711c1538ffd4acb40e18d8d3db4c2fa73155876a281f82',
 'apps/api/cmd/task-journal-software-test/main.go':'9ccbc5566ce086d52edf3d1bffa834778c400712490fa2d49acf66098c95201c',
 'scripts/agent/test-mysql-docker.sh':'eab7e53009eddfcb01100cb6b80114fc5d6d6fc04a2fd931ef268ea6ee9b3d43',
 'apps/api/internal/httpapi/testdata/oracle-simulated-registry/test/fixtures/simulated-registry-v1.json':'154b15a85d9cdeed41138a8f77981521f778db7f97d54fbc9f221cb471c1fb3c',
}
actual={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in expected}
if actual!=expected:raise SystemExit('RECEIPT_SQL_ORIGINAL_SOURCE_HASH_MISMATCH')
pathlib.Path(sys.argv[2]).write_text(json.dumps({'commit':'e007fad8682d48d52fcde321b6c273a94a2715c5','sha256':actual},indent=2)+'\n')
PY
EX_SOURCE="$WORK/ex-source"
mkdir "$EX_SOURCE"
git -C "$EX_SOURCE" init --quiet
git -C "$EX_SOURCE" fetch --quiet --depth=1 https://github.com/GiraffeTechnology/8415ex.git 8216655ec4589f5254892529e90b2dddccf4bdc2
git -C "$EX_SOURCE" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$EX_SOURCE" rev-parse HEAD)" = 8216655ec4589f5254892529e90b2dddccf4bdc2
test "$(git -C "$EX_SOURCE" rev-parse 'HEAD^{tree}')" = 2d7c77160f9b4cfe7e4efd7b4fe1c1c8dce2fd18
export EX_ORIGINAL_JOURNAL_RUNNER="$EX_SOURCE/integration/original_journal_live_consumer.py"
export EX_ORIGINAL_JOURNAL_RUNNER_SHA256=e87c61834d55818e724aba0dde9b8c5df20df249f23dce9352da3e7fee6020fe
printf '%s  %s\n' "$EX_ORIGINAL_JOURNAL_RUNNER_SHA256" "$EX_ORIGINAL_JOURNAL_RUNNER" | sha256sum --check
printf '{"repository":"GiraffeTechnology/8415ex","commit":"8216655ec4589f5254892529e90b2dddccf4bdc2","tree":"2d7c77160f9b4cfe7e4efd7b4fe1c1c8dce2fd18","runnerSHA256":"e87c61834d55818e724aba0dde9b8c5df20df249f23dce9352da3e7fee6020fe"}\n' > "$EVIDENCE/ex-source-pins.json"
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
  node --conditions=react-server "$ROOT/tests/whole-receipt-ex-sepolia-sql-client.mjs"
