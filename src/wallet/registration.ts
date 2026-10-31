import { withPresentation, presentationMessage } from './renderMessages.ts';
import type { PresentationMessage } from './renderMessages.ts';
import type { Address, Bytes32, Instant } from '../sdk/types.ts';
import type { AssetView } from './assetView.ts';
/**
 * What a pending registration means to the person holding the token.
 *
 * Everything else in this wallet answers the protocol's questions. This
 * answers the holder's: what is happening, is it broken, do I do anything, how
 * far behind is it, and what if it drags. Those are different questions, and a
 * protocol-accurate panel that never addresses them has not done the job.
 *
 * Derived entirely from an `AssetView` — no extra reads, and no claim the two
 * sequences cannot already support.
 */
export type RegistrationState =
/** The register has caught up with the position. */
'level'
/** A change is in flight, and it will bring the register level. */
 | 'registering'
/** A change is in flight, and further transfers sit behind it. */
 | 'registering-with-more-behind'
/** The position has moved and nothing is in flight to record it. */
 | 'behind-with-nothing-in-flight'
/** The contract has no settlement interface, so nothing is ever in flight. */
 | 'no-gap-interface';
export type CommitmentWindow = {
    readonly deadline: Instant;
    readonly passed: boolean;
    /** Seconds remaining; negative once the deadline has passed. */
    readonly remaining: bigint;
    readonly note: string;
};
export type RegistrationView = {
    readonly state: RegistrationState;
    readonly headline: string;
    /** What this means, in a holder's terms. */
    readonly meaning: string;
    /** What, if anything, the holder does. */
    readonly action: string;
    /** Present only while a change is in flight. */
    readonly commitmentWindow: CommitmentWindow | undefined;
    /** The holder the in-flight change will record, when one is in flight. */
    readonly registering: Address | undefined;
    /**
     * Whether further transfers are known to sit behind the one in flight.
     *
     * Not a count. Counting hops would need the ERC-721 transfer history, which
     * the wallet does not read; what it can establish is that the position has
     * moved past what the in-flight change will record, so at least one more
     * registration must follow this one.
     */
    readonly furtherHopsBehind: boolean;
    /** Who to ask, and the limit of what the wallet can resolve. */
    readonly whoToAsk: string;
    readonly registerId: Bytes32;
};
const REGISTRATION_TRANSFER_BOUNDARY = 'The token is not blocked by registration lag alone: lag itself imposes no ' +
    'registrar transfer lock. This view is not a transfer approval. Independent ' +
    'control restrictions and enforceable acceptance of active inherited conditions ' +
    'must be established separately for protected forwarding.';
const SERIAL = 'Registration is sequential and physical: the token can change hands on ' +
    'chain every few minutes, while the register records each transfer one at a ' +
    'time — first one hop, then the next. No wallet or standard removes that lag.';
export function describeRegistration(view: AssetView): RegistrationView {
    const position = view.tradeablePosition.owner;
    const confirmed = view.confirmedHolder.holder;
    const gap = view.gap;
    const inFlight = gap.kind === 'open' ? gap.expectedHolder : undefined;
    const furtherHopsBehind = inFlight !== undefined && inFlight !== position;
    const state: RegistrationState = gap.kind === 'unsupported'
        ? 'no-gap-interface'
        : gap.kind === 'open'
            ? furtherHopsBehind
                ? 'registering-with-more-behind'
                : 'registering'
            : confirmed === position
                ? 'level'
                : 'behind-with-nothing-in-flight';
    return withPresentation({
        state,
        headline: HEADLINES[state],
        meaning: meaningFor(state, { position, confirmed, inFlight }),
        action: ACTIONS[state],
        commitmentWindow: gap.kind === 'open'
            ? withPresentation({
                deadline: gap.deadline,
                passed: gap.cancellable,
                remaining: gap.timeRemaining,
                note: gap.cancellable
                    ? 'The window the register was given has passed. That is a signal the ' +
                        'transfer being recorded may itself have an issue. What follows — ' +
                        'whether a trade can be unwound, by whom, on what terms — is governed by ' +
                        'the terms you agreed with your counterparty. It is not decided by this ' +
                        'protocol and not by this wallet.'
                    : 'The register has until this time under the agreed window. The deadline ' +
                        'has not passed; that fact alone is not an assessment of the trade ' +
                        'or its independent control conditions.',
            }, {
                note: gap.cancellable ? presentationMessage("protocol.061", "The window the register was given has passed. That is a signal the transfer being recorded may itself have an issue. What follows \u2014 whether a trade can be unwound, by whom, on what terms \u2014 is governed by the terms you agreed with your counterparty. It is not decided by this protocol and not by this wallet.", {}) : presentationMessage("renderer.model.registration.b846e15a", "The register has until this time under the agreed window. The deadline has not passed; that fact alone is not an assessment of the trade or its independent control conditions.", {})
            }) : undefined,
        registering: inFlight,
        furtherHopsBehind,
        whoToAsk: whoToAsk(view),
        registerId: view.identity.registerId,
    }, {
        meaning: meaningForPresentation(state, { position, confirmed, inFlight }),
        whoToAsk: whoToAskPresentation(view),
        headline: ({
            level: presentationMessage("protocol.063", "The register is up to date", {}),
            registering: presentationMessage("protocol.064", "A transfer is being registered", {}),
            'registering-with-more-behind': presentationMessage("protocol.065", "A transfer is being registered, and more are behind it", {}),
            'behind-with-nothing-in-flight': presentationMessage("protocol.066", "The register is behind, and nothing is being recorded", {}),
            'no-gap-interface': presentationMessage("protocol.067", "This contract records no registrations in flight", {})
        })[state],
        action: ({
            level: presentationMessage("renderer.model.registration.ab3be742", "No registration action is implied by their agreement. Independent transfer conditions remain separate.", {}),
            registering: presentationMessage("renderer.model.registration.36413bae", "Wait. Registration lag alone leaves nothing to fix. This is not a transfer approval; independent control conditions remain separate.", {}),
            'registering-with-more-behind': presentationMessage("renderer.model.registration.f0b02133", "Wait. Each transfer is recorded in turn, so yours follows the one in flight. This registration status does not establish independent forwarding conditions.", {}),
            'behind-with-nothing-in-flight': presentationMessage("protocol.071", "Wait, and watch the register. No change is currently in flight, so nothing will move until the registrar opens one.", {}),
            'no-gap-interface': presentationMessage("protocol.072", "Nothing here. This contract keeps a projection by other means, so it never reports a change in flight.", {})
        })[state]
    });
}
const HEADLINES: Record<RegistrationState, string> = {
    level: 'The register is up to date',
    registering: 'A transfer is being registered',
    'registering-with-more-behind': 'A transfer is being registered, and more are behind it',
    'behind-with-nothing-in-flight': 'The register is behind, and nothing is being recorded',
    'no-gap-interface': 'This contract records no registrations in flight',
};
const ACTIONS: Record<RegistrationState, string> = {
    level: 'No registration action is implied by their agreement. Independent transfer conditions remain separate.',
    registering: 'Wait. Registration lag alone leaves nothing to fix. This is not a transfer approval; independent control conditions remain separate.',
    'registering-with-more-behind': 'Wait. Each transfer is recorded in turn, so yours follows the one in flight. ' +
        'This registration status does not establish independent forwarding conditions.',
    'behind-with-nothing-in-flight': 'Wait, and watch the register. No change is currently in flight, so nothing ' +
        'will move until the registrar opens one.',
    'no-gap-interface': 'Nothing here. This contract keeps a projection by other means, so it never ' +
        'reports a change in flight.',
};
function meaningFor(state: RegistrationState, parties: {
    position: Address;
    confirmed: Address;
    inFlight: Address | undefined;
}): string {
    switch (state) {
        case 'level':
            return (`The register confirms ${parties.confirmed}, which is also the current ` +
                `position. Nothing is pending. ${REGISTRATION_TRANSFER_BOUNDARY}`);
        case 'registering':
            return (`A previous transfer has not yet been recorded by the register. This is not a ` +
                `failure and not an error — it is the register catching up. The change in ` +
                `flight will record ${parties.inFlight}, bringing the register level with the ` +
                `position. ${SERIAL} ${REGISTRATION_TRANSFER_BOUNDARY}`);
        case 'registering-with-more-behind':
            return (`A previous transfer has not yet been recorded. This is not a failure — it is ` +
                `the register catching up. The change in flight records ${parties.inFlight}, but ` +
                `the position has already moved on to ${parties.position}, so at least one more ` +
                `registration must follow this one before the register is level. ${SERIAL} ` +
                `${REGISTRATION_TRANSFER_BOUNDARY}`);
        case 'behind-with-nothing-in-flight':
            return (`The register confirms ${parties.confirmed} while the position is ` +
                `${parties.position}, and no change is currently in flight to record the ` +
                `difference. This is not a failure; it means the registrar has not yet opened ` +
                `one. ${SERIAL} ${REGISTRATION_TRANSFER_BOUNDARY}`);
        case 'no-gap-interface':
            return ('This contract offers no settlement interface, so it never reports a change ' +
                `in flight. The register confirms ${parties.confirmed}. ${REGISTRATION_TRANSFER_BOUNDARY}`);
    }
}
/**
 * Who to ask, and what the wallet cannot tell you.
 *
 * `registerId` and the settlement authority are on-chain identifiers.
 * Resolving either to a party a person can contact is defined by the
 * verification profile and lives off chain. Saying so is better than leaving a
 * holder to conclude there is nobody to ask.
 */
function whoToAsk(view: AssetView): string {
    const authority = view.authority.account !== undefined && view.authority.authorized === true
        ? `Your own account may open a gap on this token, so you are one of the parties ` +
            `who can move the answer. `
        : '';
    return (`${authority}The register is identified on chain as ${view.identity.registerId}, and ` +
        `who may move the answer is answered by the contract for any account you name. ` +
        `Neither resolves to a name, an address or a contact from on-chain data alone — ` +
        `that mapping is defined by the verification profile and kept off chain. The wallet ` +
        `cannot look it up for you; your counterparty or the issuer can.`);
}
function meaningForPresentation(state: RegistrationState, parties: {
    position: Address;
    confirmed: Address;
    inFlight: Address | undefined;
}): PresentationMessage | undefined {
    switch (state) {
        case 'level':
            return presentationMessage("protocol.073", "The register confirms {v0}, which is also the current position. Nothing is pending. {v1}", { v0: String(parties.confirmed), v1: presentationMessage("renderer.model.registration.3cba4624", "The token is not blocked by registration lag alone: lag itself imposes no registrar transfer lock. This view is not a transfer approval. Independent control restrictions and enforceable acceptance of active inherited conditions must be established separately for protected forwarding.", {}) });
        case 'registering':
            return presentationMessage("protocol.074", "A previous transfer has not yet been recorded by the register. This is not a failure and not an error \u2014 it is the register catching up. The change in flight will record {v0}, bringing the register level with the position. {v1} {v2}", { v0: String(parties.inFlight), v1: presentationMessage("protocol.060", "Registration is sequential and physical: the token can change hands on chain every few minutes, while the register records each transfer one at a time \u2014 first one hop, then the next. No wallet or standard removes that lag.", {}), v2: presentationMessage("renderer.model.registration.3cba4624", "The token is not blocked by registration lag alone: lag itself imposes no registrar transfer lock. This view is not a transfer approval. Independent control restrictions and enforceable acceptance of active inherited conditions must be established separately for protected forwarding.", {}) });
        case 'registering-with-more-behind':
            return presentationMessage("protocol.075", "A previous transfer has not yet been recorded. This is not a failure \u2014 it is the register catching up. The change in flight records {v0}, but the position has already moved on to {v1}, so at least one more registration must follow this one before the register is level. {v2} {v3}", { v0: String(parties.inFlight), v1: String(parties.position), v2: presentationMessage("protocol.060", "Registration is sequential and physical: the token can change hands on chain every few minutes, while the register records each transfer one at a time \u2014 first one hop, then the next. No wallet or standard removes that lag.", {}), v3: presentationMessage("renderer.model.registration.3cba4624", "The token is not blocked by registration lag alone: lag itself imposes no registrar transfer lock. This view is not a transfer approval. Independent control restrictions and enforceable acceptance of active inherited conditions must be established separately for protected forwarding.", {}) });
        case 'behind-with-nothing-in-flight':
            return presentationMessage("protocol.076", "The register confirms {v0} while the position is {v1}, and no change is currently in flight to record the difference. This is not a failure; it means the registrar has not yet opened one. {v2} {v3}", { v0: String(parties.confirmed), v1: String(parties.position), v2: presentationMessage("protocol.060", "Registration is sequential and physical: the token can change hands on chain every few minutes, while the register records each transfer one at a time \u2014 first one hop, then the next. No wallet or standard removes that lag.", {}), v3: presentationMessage("renderer.model.registration.3cba4624", "The token is not blocked by registration lag alone: lag itself imposes no registrar transfer lock. This view is not a transfer approval. Independent control restrictions and enforceable acceptance of active inherited conditions must be established separately for protected forwarding.", {}) });
        case 'no-gap-interface':
            return presentationMessage("protocol.077", "This contract offers no settlement interface, so it never reports a change in flight. The register confirms {v0}. {v1}", { v0: String(parties.confirmed), v1: presentationMessage("renderer.model.registration.3cba4624", "The token is not blocked by registration lag alone: lag itself imposes no registrar transfer lock. This view is not a transfer approval. Independent control restrictions and enforceable acceptance of active inherited conditions must be established separately for protected forwarding.", {}) });
    }
}
/**
 * Who to ask, and what the wallet cannot tell you.
 *
 * `registerId` and the settlement authority are on-chain identifiers.
 * Resolving either to a party a person can contact is defined by the
 * verification profile and lives off chain. Saying so is better than leaving a
 * holder to conclude there is nobody to ask.
 */
function whoToAskPresentation(view: AssetView): PresentationMessage | undefined {
    return presentationMessage("protocol.079", "{v0}The register is identified on chain as {v1}, and who may move the answer is answered by the contract for any account you name. Neither resolves to a name, an address or a contact from on-chain data alone \u2014 that mapping is defined by the verification profile and kept off chain. The wallet cannot look it up for you; your counterparty or the issuer can.", { v0: view.authority.account !== undefined && view.authority.authorized === true ? presentationMessage("protocol.078", "Your own account may open a gap on this token, so you are one of the parties who can move the answer. ", {}) : String(''), v1: String(view.identity.registerId) });
}
