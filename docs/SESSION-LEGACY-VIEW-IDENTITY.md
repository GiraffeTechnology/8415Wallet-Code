# Shared session identity for legacy read views

PRD section 6.1 requires immutable register/profile identity to be checked across a wallet's reads. WalletSession already shared one identity pin for asset, temporal, admitted-history, audit and collision reads. Ownership history, settlement history and risk reads previously bypassed that shared pin.

Those three session entry points now check the shared identity before and after their asynchronous data reads. Source/register/profile drift refuses the result instead of returning data under an identity established by an earlier view. Projection-only settlement history explicitly reports the absent interface without probing settlement logs or claiming no gaps occurred.

This is identity consistency for session entry points, not an atomic state snapshot, block-hash pin, contract implementation attestation or transaction gate. Direct standalone builder APIs are unchanged. No signer, credential, transaction, frozen specialist input or deployment state is modified.

Eight regression cases are authored in tests/session-legacy-view-identity.test.ts, NOT_RUN. Assigned approved Linux owner should run node --test tests/session-legacy-view-identity.test.ts and existing identity/session/ownership/settlement/risk/full pipeline tests. No syntax/typecheck/test/build/CI/deployment/provider/chain execution occurred in this development increment. Full PRD acceptance remains OPEN.
