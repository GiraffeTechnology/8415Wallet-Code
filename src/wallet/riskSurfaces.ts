import { withPresentation, presentationMessage, presentationValue } from './renderMessages.ts';
import { TransportError } from '../sdk/errors.ts';
import { detectConformance, requireProjectionConformance } from '../sdk/conformance.ts';
import { ZERO_BYTES32, type Address, type Instant, type TokenId } from '../sdk/types.ts';
import type { Erc8415Reader } from '../sdk/port.ts';
import { buildSettlementLog } from './settlementLog.ts';
/**
 * The risk surfaces of PRD §4.6.
 *
 * These are reported because the ERC's security section makes each of them the
 * consumer's decision, and a wallet that hides them decides on the user's
 * behalf. They are facts with the numbers behind them. Nothing here is scored,
 * ranked, or turned into a safe/unsafe verdict, and nothing is gated on them:
 * the wallet presents risk information and does not impose settlement policy.
 */
export type RiskSurfaceId = 'stalled-register' | 'held-open-gap' | 'authority-scope' | 'profile-acceptance' | 'far-future-effective-time';
export type RiskSurface = {
    readonly id: RiskSurfaceId;
    readonly heading: string;
    /** The measurement, stated plainly. Never a judgement. */
    readonly finding: string;
    /** What the ERC says follows from it, and what it does not. */
    readonly meaning: string;
    /** True when the condition is actually present, not when it is merely possible. */
    readonly present: boolean;
};
export type RiskSurfaceView = {
    readonly tokenId: TokenId;
    readonly observedAt: Instant;
    readonly surfaces: readonly RiskSurface[];
    readonly note: string;
};
const NOTE = 'Reported as facts. The wallet does not score these, does not produce a ' +
    'safe or unsafe verdict, and gates nothing on them. What a right does with ' +
    'them is decided by its own terms.';
export async function buildRiskSurfaces(reader: Erc8415Reader, tokenId: TokenId, options: {
    readonly account?: Address;
} = {}): Promise<RiskSurfaceView> {
    const conformance = await detectConformance(reader);
    requireProjectionConformance(reader, conformance);
    if (conformance.settlement) {
        const required = ['openGapOf', 'settlement', 'verificationProfile'] as const;
        for (const method of required) {
            if (typeof reader[method] !== 'function') {
                throw new TransportError(method, 'reader capability unavailable for advertised settlement interface');
            }
        }
        if (options.account !== undefined && typeof reader.isSettlementAuthority !== 'function') {
            throw new TransportError('isSettlementAuthority', 'reader capability unavailable for advertised settlement interface');
        }
    }
    const observedAt = await reader.chainInstant();
    const latest = await reader.currentEntry(tokenId);
    const surfaces: RiskSurface[] = [];
    // Stalled register.
    const standing = observedAt - latest.effectiveAt;
    surfaces.push(withPresentation({
        id: 'stalled-register',
        heading: 'How long the latest entry has stood',
        finding: standing < 0n
            ? `The latest entry (v${latest.version}) has effective time ${latest.effectiveAt}, ` +
                `${-standing} seconds ahead of now; no elapsed standing time is reported.`
            : `The latest entry (v${latest.version}) took effect at ${latest.effectiveAt}; ` +
                `${standing} seconds have passed since. No entry has been admitted after it.`,
        meaning: 'Finality depends on a later entry existing. A register that stops ' +
            'producing entries leaves recent instants non-final for as long as it ' +
            'stays stopped, and anything waiting on them waits with them; a ' +
            'genuine later entry, once registered, makes them final. The clock ' +
            'running on does not do it. This is a liveness dependency on the ' +
            'register and its profile, not a safety defect.',
        present: standing > 0n,
    }, {
        heading: presentationMessage("protocol.107", "How long the latest entry has stood", {}),
        finding: standing < 0n ? presentationMessage("renderer.model.riskSurfaces.260ceff2", "The latest entry (v{v0}) has effective time {v1}, {v2} seconds ahead of now; no elapsed standing time is reported.", { v0: presentationValue(latest, "version"), v1: presentationValue(latest, "effectiveAt"), v2: String(-standing) }) : presentationMessage("protocol.108", "The latest entry (v{v0}) took effect at {v1}; {v2} seconds have passed since. No entry has been admitted after it.", { v0: presentationValue(latest, "version"), v1: presentationValue(latest, "effectiveAt"), v2: String(standing) }),
        meaning: presentationMessage("protocol.109", "Finality depends on a later entry existing. A register that stops producing entries leaves recent instants non-final for as long as it stays stopped, and anything waiting on them waits with them; a genuine later entry, once registered, makes them final. The clock running on does not do it. This is a liveness dependency on the register and its profile, not a safety defect.", {})
    }));
    // Held-open gap, measured by supersessions.
    const log = conformance.settlement ? await buildSettlementLog(reader, tokenId) : undefined;
    const supersessions = log?.episodes.filter((episode) => episode.closure === 'superseded').length ?? 0;
    const openGap = conformance.settlement && reader.openGapOf !== undefined
        ? await reader.openGapOf(tokenId)
        : ZERO_BYTES32;
    surfaces.push(withPresentation({
        id: 'held-open-gap',
        heading: 'Supersessions on this token',
        finding: !conformance.settlement
            ? 'This contract advertises no settlement interface; no gap or supersession observation is reported.'
            : log?.available
                ? `${supersessions} settlement(s) on this token were superseded rather than ` +
                    `admitted or cancelled. A gap is ${openGap === ZERO_BYTES32 ? 'not ' : ''}open now.`
                : 'Logs could not be read, so supersessions cannot be counted. Absence of a ' +
                    'count here is not a count of zero.',
        meaning: 'Whoever may begin settlements can supersede indefinitely, keeping a ' +
            "token's gap open and leaving every recent instant non-final and " +
            'contested. Nothing is misreported when this happens — the projection ' +
            'states exactly that the answer is unsettled — but it stops tracking the ' +
            'register, which is the one thing it exists to do.',
        present: supersessions > 0,
    }, {
        heading: presentationMessage("protocol.110", "Supersessions on this token", {}),
        finding: !conformance.settlement ? presentationMessage("renderer.model.riskSurfaces.e25bfdbb", "This contract advertises no settlement interface; no gap or supersession observation is reported.", {}) : log?.available ? (openGap === ZERO_BYTES32 ? presentationMessage("renderer.model.riskSurfaces.gapClosed", "{v0} settlement(s) on this token were superseded rather than admitted or cancelled. A gap is not open now.", { v0: String(supersessions) }) : presentationMessage("renderer.model.riskSurfaces.gapOpen", "{v0} settlement(s) on this token were superseded rather than admitted or cancelled. A gap is open now.", { v0: String(supersessions) })) : presentationMessage("protocol.112", "Logs could not be read, so supersessions cannot be counted. Absence of a count here is not a count of zero.", {}),
        meaning: presentationMessage("protocol.113", "Whoever may begin settlements can supersede indefinitely, keeping a token's gap open and leaving every recent instant non-final and contested. Nothing is misreported when this happens \u2014 the projection states exactly that the answer is unsettled \u2014 but it stops tracking the register, which is the one thing it exists to do.", {})
    }));
    // Authority scope.
    const authorized = conformance.settlement && reader.isSettlementAuthority !== undefined && options.account !== undefined
        ? await reader.isSettlementAuthority(tokenId, options.account)
        : undefined;
    surfaces.push(withPresentation({
        id: 'authority-scope',
        heading: 'Who may move the answer',
        finding: !conformance.settlement
            ? 'This contract offers no settlement interface, so no authority is reported.'
            : options.account === undefined
                ? 'No account was supplied, so no authority is reported. `isSettlementAuthority` ' +
                    'answers for any account you name.'
                : `isSettlementAuthority reports ${authorized} for ${options.account}.`,
        meaning: 'The ability to begin settlements is a privilege: it can advance the ' +
            'projection and it can withhold. Reading who holds it is not approving ' +
            'them — a consumer relying on the projection must decide whether it ' +
            'accepts that authority, exactly as it must decide about the profile.',
        present: conformance.settlement,
    }, {
        heading: presentationMessage("protocol.114", "Who may move the answer", {}),
        finding: !conformance.settlement ? presentationMessage("protocol.115", "This contract offers no settlement interface, so no authority is reported.", {}) : options.account === undefined ? presentationMessage("protocol.116", "No account was supplied, so no authority is reported. `isSettlementAuthority` answers for any account you name.", {}) : presentationMessage("protocol.117", "isSettlementAuthority reports {v0} for {v1}.", { v0: String(authorized), v1: presentationValue(options, "account") }),
        meaning: presentationMessage("protocol.118", "The ability to begin settlements is a privilege: it can advance the projection and it can withhold. Reading who holds it is not approving them \u2014 a consumer relying on the projection must decide whether it accepts that authority, exactly as it must decide about the profile.", {})
    }));
    // Profile acceptance.
    const profile = conformance.settlement && reader.verificationProfile !== undefined
        ? await reader.verificationProfile()
        : undefined;
    surfaces.push(withPresentation({
        id: 'profile-acceptance',
        heading: 'What is accepted as proof',
        finding: profile === undefined
            ? 'This contract names no verification profile, so what it accepts as proof ' +
                'cannot be identified from here.'
            : `Proofs are accepted under profile ${profile}.`,
        meaning: 'A proof establishes that bytes were included in accepted finalized ' +
            'remote state. It does not establish that an asset exists, that a ' +
            'registrar told the truth, or that a record is legally effective. Where ' +
            'the register is not itself a ledger with consensus, some party commits ' +
            'to its contents; identifying that party is part of the profile you must ' +
            'accept before relying on the projection.',
        present: true,
    }, {
        heading: presentationMessage("protocol.119", "What is accepted as proof", {}),
        finding: profile === undefined ? presentationMessage("protocol.120", "This contract names no verification profile, so what it accepts as proof cannot be identified from here.", {}) : presentationMessage("protocol.121", "Proofs are accepted under profile {v0}.", { v0: String(profile) }),
        meaning: presentationMessage("protocol.122", "A proof establishes that bytes were included in accepted finalized remote state. It does not establish that an asset exists, that a registrar told the truth, or that a record is legally effective. Where the register is not itself a ledger with consensus, some party commits to its contents; identifying that party is part of the profile you must accept before relying on the projection.", {})
    }));
    // Far-future effective time.
    const drift = latest.effectiveAt > observedAt ? latest.effectiveAt - observedAt : 0n;
    surfaces.push(withPresentation({
        id: 'far-future-effective-time',
        heading: 'Effective time ahead of now',
        finding: drift === 0n
            ? "The latest entry's effective time is at or before now."
            : `The latest entry's effective time is ${drift} seconds ahead of now.`,
        meaning: 'Later entries must have strictly greater effective times within uint64, ' +
            'so this value blocks every later entry whose effective time is not ' +
            'greater than it. That bounds admission; it ' +
            'does not by itself prove that no later entry can ' +
            'be admitted or that the state is unrecoverable. A later entry may ' +
            'still be admitted, but only once one is actually registered: a ' +
            'strictly greater effective time, genuine registration evidence, and ' +
            'the time rules the profile applies, including its limit on how far ' +
            'ahead an effective time may be. At the uint64 maximum, ' +
            'no greater effective time is representable. Assess the actual value ' +
            'and the profile; this measurement is not a finality verdict.',
        // Any future effective time is reported, with the distance as the fact.
        // A threshold here would decide for the reader when the distance starts to
        // matter, and this surface scores nothing; the id is the original one.
        present: drift > 0n,
    }, {
        heading: presentationMessage("protocol.123", "Effective time ahead of now", {}),
        finding: drift === 0n ? presentationMessage("protocol.124", "The latest entry's effective time is at or before now.", {}) : presentationMessage("protocol.125", "The latest entry's effective time is {v0} seconds ahead of now.", { v0: String(drift) }),
        meaning: presentationMessage("renderer.model.riskSurfaces.f3fbdc6e", "Later entries must have strictly greater effective times within uint64, so this value blocks every later entry whose effective time is not greater than it. That bounds admission; it does not by itself prove that no later entry can be admitted or that the state is unrecoverable. A later entry may still be admitted, but only once one is actually registered: a strictly greater effective time, genuine registration evidence, and the time rules the profile applies, including its limit on how far ahead an effective time may be. At the uint64 maximum, no greater effective time is representable. Assess the actual value and the profile; this measurement is not a finality verdict.", {})
    }));
    return withPresentation({ tokenId, observedAt, surfaces, note: NOTE }, {
        note: presentationMessage("protocol.106", "Reported as facts. The wallet does not score these, does not produce a safe or unsafe verdict, and gates nothing on them. What a right does with them is decided by its own terms.", {})
    });
}
