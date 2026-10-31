/** Standalone profile uses only its own installation capability composition. */
import { protect,protectedAncestors,exclusive,replace } from './install.mjs';
import { createManagedOriginContinuation } from '../auth-runtime/origin-continuation-core.mjs';
export const continueManagedOrigin=createManagedOriginContinuation({protect,protectedAncestors,exclusive,replace});
