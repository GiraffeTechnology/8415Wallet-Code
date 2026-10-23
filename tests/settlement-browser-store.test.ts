import { hashControlBytes } from '../src/controls/authorization.ts';
import { parseSettlementState, serializeSettlementState } from '../src/wallet/standaloneSettlement.ts';
import { browserJournalSuite } from './helpers/browser-journal-fixture.ts';

browserJournalSuite({ label: 'standalone settlement journal', module: 'settlement-store.mjs',
  className: 'BrowserSettlementStore', parse: parseSettlementState as never, serialize: serializeSettlementState as never,
  args: [560048n, `0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`],
  state: { schema: '8415-settlement-operation/1', revision: 0n, status: 'idle',
    deployment: { chainId: 560048n, controller: `0x${'1'.repeat(40)}`, runtimeCodeHash: hashControlBytes('0x6000') },
    actor: `0x${'2'.repeat(40)}`, requestDigest: null, submission: null } as never });
