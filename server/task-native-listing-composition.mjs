/** Explicit server-only composition of Wallet grants and the ArtFi native task port.
 * No runtime defaults, routes, signer credentials, session emulation or Go transport.
 * Native journal, bridge journal and Wallet grant store must be separate stores:
 * the grant gate remains held across the actual sign/publish boundary. */
import { freezeNftListingChild } from '../src/agent/taskContract.ts';

const fail = code => { throw Error(code); };
const requireThat = (ok, code) => { if (!ok) fail(code); };
const copy = v => structuredClone(v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const immutable = v => { if (v && typeof v === 'object') { Object.values(v).forEach(immutable); Object.freeze(v); } return v; };
const methods = (v, names) => Object.freeze(Object.fromEntries(names.map(n => { requireThat(typeof v?.[n] === 'function', 'LISTING_COMPOSITION_CONFIGURATION_REQUIRED'); return [n, v[n].bind(v)]; })));

export function createTaskNativeListingComposition({ bridgeStore, createNativeNftTaskPort, nativeDependencies,
  createNftSaleTermsVerifier, ethers, validation, readNftRequest, kernelRequestDigest,
  signer, signerTimeoutMs, quoteSource, requestSource, createListedOrderObserver, observationDependencies, now = Date.now }) {
  requireThat(typeof bridgeStore?.transactionMany === 'function' && typeof bridgeStore?.readMany === 'function' &&
    [createNativeNftTaskPort, createNftSaleTermsVerifier, readNftRequest, kernelRequestDigest, quoteSource, requestSource, createListedOrderObserver, now].every(f => typeof f === 'function'), 'LISTING_COMPOSITION_CONFIGURATION_REQUIRED');
  const signing = methods(signer, ['signTypedData']);
  requireThat(Number.isSafeInteger(signerTimeoutMs) && signerTimeoutMs >= 1 && signerTimeoutMs <= 60000, 'LISTING_SIGNER_TIMEOUT_REQUIRED');
  requireThat(typeof observationDependencies?.readOnlyProvider?.request === 'function', 'LISTING_OBSERVER_CONFIGURATION_REQUIRED');
  const observation = { ...copy({ ...observationDependencies, readOnlyProvider: null, ethers: null }), ethers,
    readOnlyProvider: { sourceId: observationDependencies.readOnlyProvider.sourceId, request: observationDependencies.readOnlyProvider.request.bind(observationDependencies.readOnlyProvider) } };
  function observerFor(snapshot, order) {
    requireThat(snapshot.observationPolicy?.policy?.minimumConfirmations, 'LISTING_OBSERVER_CONFIGURATION_REQUIRED');
    return createListedOrderObserver({ ...observation, expectedOrder: order, now, observationPolicy: { id: observation.policyId,
      taskDigest: snapshot.task.digest, chainId: snapshot.task.policy.chainId, sourceId: observation.readOnlyProvider.sourceId,
      minimumConfirmations: Number(snapshot.observationPolicy.policy.minimumConfirmations) } });
  }
  const native = Object.freeze({ ...nativeDependencies });
  validation = Object.freeze(Object.fromEntries(['validateTypedData', 'validateComponents', 'orderHash'].map(name => {
    requireThat(typeof validation?.[name] === 'function', 'LISTING_COMPOSITION_CONFIGURATION_REQUIRED'); return [name, validation[name].bind(validation)];
  })));
  let authority = null, port = null;
  const recordKey = b => `task-native-listing:${kernelRequestDigest(b)}`;
  const bindingFor = input => ({ taskId: input.task.policy.taskId, taskDigest: input.task.digest, executorDigest: input.executor.digest,
    grantReference: input.grantReference, grantPolicyVersion: input.grantPolicyVersion,
    operationId: input.child?.child.operationId ?? `listing:${input.task.digest.slice(2)}` });
  const resultBinding = input => ({ taskDigest: input.task.digest, childDigest: input.child.digest, executorDigest: input.executor.digest,
    grantReference: input.grantReference, grantPolicyVersion: input.grantPolicyVersion, valuationPolicyDigest: input.valuationPolicy.digest,
    quoteEvidenceDigest: input.child.child.quoteEvidenceDigest, orderHash: input.child.child.orderHash, typedDataDigest: input.child.child.typedDataDigest });
  async function record(b) {
    requireThat(authority && port, 'LISTING_COMPOSITION_NOT_CONNECTED');
    const k = recordKey(b), r = (await bridgeStore.readMany([k]))[k];
    requireThat(r?.schema === '8415-native-listing-composition/1' && kernelRequestDigest(r.binding) === kernelRequestDigest(b), 'LISTING_COMPOSITION_RECORD_REQUIRED'); return r;
  }
  function terms(snapshot, plan, quote) {
    const reference = { taskDigest: snapshot.task.digest, nativeOperationId: plan.operationId, nativePlanId: plan.id,
      reviewDigest: kernelRequestDigest(plan), orderHash: plan.orderHash,
      typedDataDigest: ethers.TypedDataEncoder.hash(plan.typedData.domain, plan.typedData.types, plan.typedData.message) };
    const assessment = createNftSaleTermsVerifier({ ethers, validation, readNftRequest, frozenTask: snapshot.task,
      nativePlan: plan, adapterId: 'artfi:seaport', valuationPolicy: snapshot.valuationPolicy.policy, trustedQuote: quote })(reference, now());
    requireThat(assessment.state === 'MATCHED', `LISTING_TERMS_${assessment.reason}`);
    requireThat(assessment.order.binding.valuationPolicyDigest === snapshot.valuationPolicy.digest &&
      assessment.order.binding.quoteEvidenceDigest === kernelRequestDigest(quote), 'LISTING_VALUATION_BINDING_REFUSED');
    return assessment.order;
  }
  function deadline(snapshot, quote, plan = null) {
    const p = snapshot.valuationPolicy.policy;
    const value = [BigInt(snapshot.task.policy.expiresAt), BigInt(p.validUntil), BigInt(quote.expiresAt),
      BigInt(quote.observedAt) + BigInt(p.maxAgeSeconds)].reduce((a, b) => a < b ? a : b) * 1000n;
    requireThat(value <= BigInt(Number.MAX_SAFE_INTEGER), 'LISTING_SIDE_EFFECT_DEADLINE_EXPIRED');
    const bounded = plan === null ? Number(value) : Math.min(Number(value), plan.expiresAt, plan.request.expiresAt * 1000);
    requireThat(Number.isSafeInteger(bounded) && bounded > now(), 'LISTING_SIDE_EFFECT_DEADLINE_EXPIRED'); return bounded;
  }
  function verifiedTask(snapshot, b, quote, plan) {
    const p = snapshot.task.policy;
    return { binding: copy(b), actor: p.actor, chainId: Number(p.chainId), expiresAt: Number(p.expiresAt), intent: copy(p.intent),
      sideEffectDeadlineAtMs: deadline(snapshot, quote, plan) };
  }
  function compareChild(input, r, plan, order) {
    const expected = normalizedChild(input, r.reference, plan, order);
    requireThat(freezeNftListingChild(expected).digest === input.child.digest && equal(expected, input.child.child), 'LISTING_CHILD_NATIVE_BINDING_REFUSED');
  }
  function childFor(input, reference, plan, order) {
    const b = reference.taskBinding;
    return { schema: '8415-nft-listing-child/1', operationId: b.operationId, taskDigest: b.taskDigest, executorDigest: b.executorDigest,
      grantReference: b.grantReference, grantPolicyVersion: b.grantPolicyVersion, chainId: input.task.policy.chainId,
      seller: input.task.policy.actor, protocol: order.protocol.toLowerCase(), nft: { standard: input.task.policy.intent.standard, contract: input.task.policy.intent.contract, tokenId: input.task.policy.intent.tokenId, quantity: input.task.policy.intent.quantity },
      adapterId: 'artfi:seaport', nativeOperationId: reference.nativeOperationId, nativePlanId: reference.nativePlanId,
      reviewDigest: reference.reviewDigest, orderHash: reference.orderHash.toLowerCase(), typedDataDigest: reference.typedDataDigest.toLowerCase(),
      counter: order.components.counter, salt: order.components.salt, expiresAt: order.components.endTime,
      valuationPolicyDigest: order.binding.valuationPolicyDigest, quoteEvidenceDigest: order.binding.quoteEvidenceDigest, fees: { maximumFeeWei: '0' } };
  }
  function normalizedChild(input, reference, plan, order) { return freezeNftListingChild(childFor(input, reference, plan, order)).child; }
  async function checkNative(b, context, snapshot) {
    const r = await record(b);
    const current = snapshot ?? await authority.inspect(b, context.purpose);
    if (context.plan && context.purpose !== 'observe') {
      const order = terms(current, context.plan, r.quote);
      if (current.child) compareChild({ ...current, child: current.child }, r, context.plan, order);
    }
    if (context.purpose === 'observe') {
      const p = current.task.policy;
      return { binding: copy(b), actor: p.actor, chainId: Number(p.chainId), expiresAt: Number(p.expiresAt), intent: copy(p.intent) };
    }
    return verifiedTask(current, b, r.quote, context.plan);
  }
  function submission(input) { const c = input.child.child; return { kind: 'seaport-order', chainId: c.chainId, protocol: c.protocol, orderHash: c.orderHash }; }
  const execution = Object.freeze({
    async plan(input) {
      requireThat(authority && port, 'LISTING_COMPOSITION_NOT_CONNECTED');
      const b = bindingFor(input), k = recordKey(b);
      const fresh = await authority.inspect(b, 'prepare');
      let r = (await bridgeStore.readMany([k]))[k];
      if (!r) {
        const quote = copy(await quoteSource(copy(fresh.valuationPolicy.policy))), request = copy(await requestSource(copy(fresh.task)));
        deadline(fresh, quote);
        const saved = await bridgeStore.transactionMany([k], values => ({ [k]: values[k] ?? { schema: '8415-native-listing-composition/1', binding: b,
          request, quote, reference: null, order: null, reviewState: 'not-started', signingStarted: false } })); r = saved[k];
      }
      requireThat(kernelRequestDigest(r.binding) === kernelRequestDigest(b) && !r.signingStarted, 'LISTING_COMPOSITION_REPLAN_REFUSED');
      const ref = r.reference ?? await port.prepareListing(b, copy(r.request));
      const read = await port.readPublication(ref), plan = read.recoverySnapshot.unsignedPlan;
      requireThat(!read.recoverySnapshot.walletStarted && !read.publicationAccepted, 'LISTING_COMPOSITION_REPLAN_REFUSED');
      const order = terms(fresh, plan, r.quote), child = normalizedChild(input, ref, plan, order);
      await bridgeStore.transactionMany([k], values => {
        requireThat(values[k] && !values[k].signingStarted && (values[k].reference === null || equal(values[k].reference, ref)), 'LISTING_COMPOSITION_CONFLICT');
        return { [k]: { ...values[k], reference: ref, order } };
      });
      return child;
    },
    async verify(input) {
      const b = bindingFor(input), k = recordKey(b), r = await record(b);
      requireThat(!r.signingStarted && r.reference, 'LISTING_SIGNING_ALREADY_ATTEMPTED');
      const fresh = await authority.inspect(b, 'review');
      let read = await port.readPublication(r.reference), plan = read.recoverySnapshot.unsignedPlan;
      const order = terms(fresh, plan, r.quote); compareChild(input, r, plan, order);
      if (!read.recoverySnapshot.walletStarted) {
        await bridgeStore.transactionMany([k], v => ({ [k]: { ...v[k], reviewState: 'started' } }));
        plan = (await port.reviewListing(r.reference)).plan;
      }
      // A recovered unsigned plan is usable only because this same durable Wallet
      // child is still reserved and the separate durable signing claim is absent.
      requireThat(fresh.operationStatus === 'reserved', 'LISTING_REVIEW_RECOVERY_REFUSED');
      compareChild(input, r, plan, terms(fresh, plan, r.quote));
      await bridgeStore.transactionMany([k], v => { requireThat(!v[k].signingStarted, 'LISTING_SIGNING_ALREADY_ATTEMPTED'); return { [k]: { ...v[k], reviewState: 'reviewed' } }; });
      observerFor(fresh, order); // Construct the actual configured evaluator/reader before claiming capability.
      return { ...resultBinding(input), capability: 'nft-listing-observable' };
    },
    async send(input) {
      const b = bindingFor(input), k = recordKey(b), r = await record(b);
      requireThat(r.reviewState === 'reviewed' && !r.signingStarted, 'LISTING_SIGNING_ALREADY_ATTEMPTED');
      const read = await port.readPublication(r.reference), plan = read.recoverySnapshot.unsignedPlan;
      const signature = await authority.withAuthorization(b, 'sign', async (fresh, recheck) => {
        const order = terms(fresh, plan, r.quote); compareChild(input, r, plan, order);
        await bridgeStore.transactionMany([k], v => {
          requireThat(v[k]?.reviewState === 'reviewed' && !v[k].signingStarted, 'LISTING_SIGNING_ALREADY_ATTEMPTED');
          return { [k]: { ...v[k], signingStarted: true } };
        });
        recheck(); terms(fresh, plan, r.quote); deadline(fresh, r.quote, plan);
        // No race-with-timeout: the grant gate remains held until this exact call
        // settles. The configured transport must own bounded abort/settlement.
        const deadlineAtMs = deadline(fresh, r.quote, plan), controller = new AbortController();
        const timer = setTimeout(() => controller.abort(Error('LISTING_SIGNER_TIMEOUT')), Math.min(signerTimeoutMs, deadlineAtMs - now()));
        try {
          const returned = await signing.signTypedData(immutable(copy({ binding: b, childDigest: input.child.digest,
            typedDataDigest: input.child.child.typedDataDigest, typedData: plan.typedData, deadlineAtMs })), { signal: controller.signal });
          requireThat(!controller.signal.aborted && typeof returned === 'string' && /^0x[0-9a-fA-F]+$/.test(returned), 'LISTING_SIGNER_RESULT_REFUSED');
          return returned;
        } finally { clearTimeout(timer); }
      });
      const published = await port.publishListing(r.reference, signature);
      requireThat(published.publicationAccepted && published.orderHash?.toLowerCase() === input.child.child.orderHash, 'LISTING_PUBLICATION_UNKNOWN');
      return { ...resultBinding(input), submission: submission(input) };
    },
    async recover(input) {
      const b = bindingFor(input), r = await record(b), published = await port.readPublication(r.reference);
      requireThat(published.publicationAccepted && published.orderHash?.toLowerCase() === input.child.child.orderHash, 'LISTING_PUBLICATION_UNKNOWN');
      return { ...resultBinding(input), state: 'submitted', submission: submission(input) };
    },
  });
  return Object.freeze({
    execution,
    connectListingAuthorization(configured) {
      requireThat(authority === null, 'LISTING_COMPOSITION_ALREADY_CONNECTED');
      requireThat(typeof configured?.assertIndependentStore === 'function', 'LISTING_COMPOSITION_CONFIGURATION_REQUIRED');
      configured.assertIndependentStore(bridgeStore);
      authority = methods(configured, ['inspect', 'withAuthorization']);
      port = createNativeNftTaskPort({ ...native,
        verifyTaskBinding: (b, context) => checkNative(b, context),
        withTaskAuthorization: (b, purpose, plan, action) => authority.withAuthorization(b, purpose, async (snapshot, recheck) => {
          const fresh = await checkNative(b, { purpose, plan }, snapshot);
          recheck(); return action(fresh);
        }),
      });
    },
    async observation(input) {
      const b = bindingFor(input), r = await record(b), fresh = await authority.inspect(b, 'observe');
      const published = await port.readPublication(r.reference);
      requireThat(published.publicationAccepted && r.order, 'LISTING_PUBLICATION_UNKNOWN');
      return { order: immutable(copy(r.order)), observer: { observe: observerFor(fresh, r.order) } };
    },
    async publishedOrder(input) {
      const b = bindingFor(input), r = await record(b);
      const published = await port.readPublication(r.reference);
      requireThat(published.publicationAccepted && r.order, 'LISTING_PUBLICATION_UNKNOWN');
      return immutable(copy(r.order));
    },
  });
}
