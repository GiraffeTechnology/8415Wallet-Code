/** Source-bound managed continuation; no service or proxy activation. */
import { protect,protectedAncestors,exclusive,replace } from './install.mjs';
import { createManagedOriginContinuation } from './origin-continuation-core.mjs';
export const continueManagedOrigin=createManagedOriginContinuation({protect,protectedAncestors,exclusive,replace});
