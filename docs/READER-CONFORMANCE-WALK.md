# Reader conformance: complete entry-walk checks

Initial Stage 1 increment following PR127, implementing PRD 2.1's common
adapter-conformance boundary. This does not certify a deployment.

The diagnostic harness now checks requested versus returned walk versions,
predecessor commitments, superseded interval endpoints, per-token reference
uniqueness, the walked latest interval and complete currentEntry agreement.
Commitment/reference comparisons use byte-value hex keys without mutating raw
answers. Invalid uint64 entry counts stop the walk with a finding.

These findings supplement existing monotonic-effective-time, first/latest,
resolution, finality and revert checks. The harness never substitutes calculated
holder/finality answers into an adapter. It still walks all declared entries;
no arbitrary history cap or ERC-8415 unresolved-window restriction is introduced.

Reads are sequential observations, not a pinned atomic snapshot. A disagreement
can reflect a changing backend/state and does not alone prove contract misconduct.
A clean report is only scoped adapter-observation evidence, not genuine-wallet,
provider, mainnet, deployment or complete-product acceptance.

Twelve regression cases are AUTHORED_NOT_RUN. No syntax/typecheck, tests, build,
provider or chain execution was performed here. Bear owns exact-candidate
approved-Linux QA and post-submission fixes, including readerConformance,
RPC/Kit harnesses and existing vectors. Frozen specialist inputs and deployment
parameters are unchanged; source-closure pins remain the integration owner's job.
