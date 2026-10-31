# Original EX dispatch fence: source integration boundary

This candidate is source-only and NOT_RUN. It does not install a runtime,
listener, credentials, deployment, signer, or a product installer.

The original EX host creates a private AF_UNIX socketpair and retains one end
bound to its `OriginalFenceChannel` and original `WalletDispatchFence` over the
same authoritative full-row checkpoint. It passes only the other descriptor to
the original Wallet process. Before composing the EX-specific exact executor,
call `createInheritedBusinessFence({fd, expectedSource:{commit,tree}, scope})`
from `server/task-business-fence-fd.mjs`; install that returned capability as
`serverConfiguration.businessDispatchFence` in the original exact runtime.
Pin the reviewed EX commit/tree and actual original scope. The handshake only
checks version consistency; authority comes from the held descriptor, not hashes
or an HTTP response. No browser/HTTP parameter may supply or replace this port.
The fixed capability identity participates in the executor implementation digest;
existing grants for a different executor digest must not be silently migrated.
Ordinary non-EX Wallet executors keep the original null optional port.

`tasks/plan-reserve` accepts only taskDigest and expectedBudgetRevision. It calls
the original planner and original durable reserve, never resume or execute.
Existing unique live reservations are read back; cancelled/ambiguous/history
requires reconciliation, not replanning. It returns the original child envelope,
reservation and status. The owner task locator uses the original owner session
prepare/authorize flow. Owner authorization retains its original server queue;
UI hold is not an execution pause and ALL ON remains unchanged.

At every original exact-adapter send, the fixed port claims the original EX row
UNKNOWN with the exact canonical task/child/binding before signing. The original
Wallet durable nonce/attempt claim still prevents duplicate send. At actual
signing and again before broadcast the original EX claim is asserted alongside
the Wallet's existing authority checks. Recovery never claims or signs.
A malformed, refused, timed-out or disconnected channel is poisoned, not retried
or reconnected; an unknown result requires original read-only reconciliation.
A repeated same-binding claim is not authorization to repeat a Wallet send.

Wire protocol: newline UTF-8, at most 65,536 bytes per frame. Initial request is
`{seq:0,action:"hello"}`; response is
`{seq:0,ok:true,channel:{schema:"8415-ex-fence-channel/1",source:{commit,tree},scope}}`.
Requests thereafter are strictly increasing serial safe integer sequences and
`{seq,action:"claim"|"assert",event:{binding,task,child},receipt:null|originalReceipt}`.
Success response is `{seq,ok:true,receipt}`. A refusal poisons the Node channel.
No network listener, automatic restart, scheduled loop or fallback is supplied.

Separate pending acceptance: integrated host source pin and fd inheritance,
authoritative store binding, approved-runtime CI/tests, browser owner flow,
actual execution and read-only recovery. Source hash verification proves none
of these runtime outcomes.
