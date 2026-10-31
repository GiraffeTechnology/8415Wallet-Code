import { withPresentation, presentationMessage, presentationValue, pushPresentation } from './renderMessages.ts';
import type { Address, Instant } from '../sdk/types.ts';
import type { AssetView } from './assetView.ts';
import { describeRegistration, type RegistrationView } from './registration.ts';
/**
 * What someone about to acquire this token should know first.
 *
 * The same facts a current holder sees, framed for a decision not yet made.
 * Deliberately not a score, not a recommendation, and not a gate: whether the
 * risk is acceptable is the acquirer's decision, reflected in the terms they
 * agree, exactly as with any other settlement risk.
 */
export type AcquisitionDisclosure = {
    readonly tokenId: bigint;
    readonly position: Address;
    readonly confirmedHolder: Address;
    readonly registration: RegistrationView;
    /** Facts, each stated plainly. No ranking, no weighting. */
    readonly points: readonly string[];
    readonly boundary: string;
};
const BOUNDARY = 'These are facts, not advice. This disclosure does not score the token, does not ' +
    'say whether acquiring is wise, and does not prevent you from making a decision. ' +
    'It is not a grant or an executable transfer approval. Whether this risk is ' +
    'acceptable is your decision; independent controls and the terms you agree ' +
    'with your counterparty still apply.';
export function describeAcquisition(view: AssetView, at: Instant): AcquisitionDisclosure {
    const registration = describeRegistration(view);
    const points: string[] = [];
    pushPresentation(points, presentationMessage("protocol.094", "Acquiring the token moves the tradeable position to you immediately. It does not move the register: the register confirms {v0}, and it will not confirm you until a transfer to you is recorded in turn.", { v0: presentationValue(view.confirmedHolder, "holder") }));
    const finality = view.presentFinality;
    pushPresentation(points, at === view.observedAt && at === finality.instant ? presentationMessage("renderer.model.acquisition.6646a9be", "At the observed instant ({v0}), isFinalAsOf reports {v1}. {v2} This is an observed protocol answer, not a prediction about a later purchase instant or a transfer approval.", { v0: String(at), v1: finality.final ? presentationMessage("protocol.021", "final", {}) : presentationMessage("renderer.model.acquisition.ee91981a", "not final", {}), v2: presentationValue(finality, "explanation") }) : presentationMessage("protocol.acquisition.unobserved", "No finality answer for the acquisition instant ({v0}) was obtained in this view. Read isFinalAsOf at that exact instant; neither the clock nor an acquisition supplies a finality answer.", { v0: String(at) }));
    if (registration.state === 'registering-with-more-behind') {
        pushPresentation(points, presentationMessage("protocol.096", "A registration is already in flight for a transfer that is not the current position, so at least one registration must complete before yours can even begin. You are joining a queue, not the front of one.", {}));
    }
    else if (registration.state === 'registering') {
        pushPresentation(points, presentationMessage("protocol.097", "A registration is in flight for the current position. Yours would follow it.", {}));
    }
    else if (registration.state === 'behind-with-nothing-in-flight') {
        pushPresentation(points, presentationMessage("protocol.098", "The register is behind the position and nothing is in flight to record it. Nothing will move until the registrar opens a change.", {}));
    }
    if (view.gap.kind === 'open') {
        pushPresentation(points, presentationMessage('protocol.099', 'The open gap runs to {v0}{v1}', { v0: String(view.gap.deadline), v1: view.gap.cancellable
                ? presentationMessage('protocol.100', ', and that time has already passed. Under the terms in force, a window that has passed may itself be a signal worth asking about.', {})
                : presentationMessage('renderer.acquisition.windowCurrent', '. The agreed deadline has not passed; that alone does not establish that the trade or its independent conditions are acceptable.', {}) }));
    }
    if (view.gap.kind === 'unsupported') {
        pushPresentation(points, presentationMessage("protocol.102", "This contract offers no settlement interface, so it never reports a change in flight. That is a property of the contract, not evidence that the register is current.", {}));
    }
    pushPresentation(points, presentationMessage('protocol.103', 'What this projects, and under whose rules, is identified on chain as register {v0}{v1}', { v0: String(view.identity.registerId), v1: view.identity.verificationProfile === undefined
            ? presentationMessage('protocol.104', ', with no verification profile named — what it accepts as proof cannot be identified from here.', {})
            : presentationMessage('protocol.105', ' under profile {v0}. Whether you accept that register and those proof rules is your decision to make before relying on any of this.', { v0: String(view.identity.verificationProfile) }) }));
    pushPresentation(points, presentationMessage("renderer.model.acquisition.23d43657", "Registration lag itself imposes no registrar transfer lock. Protected linked receipt or forwarding separately requires explicit, enforceable acceptance of the exact leg terms and all still-active inherited conditions through the responsible control. Wallet connection, a notification or payment approval alone does not establish that protection. This disclosure does not verify it.", {}));
    return withPresentation({
        tokenId: view.tokenId,
        position: view.tradeablePosition.owner,
        confirmedHolder: view.confirmedHolder.holder,
        registration,
        points,
        boundary: BOUNDARY,
    }, {
        boundary: presentationMessage("renderer.model.acquisition.613e0970", "These are facts, not advice. This disclosure does not score the token, does not say whether acquiring is wise, and does not prevent you from making a decision. It is not a grant or an executable transfer approval. Whether this risk is acceptable is your decision; independent controls and the terms you agree with your counterparty still apply.", {})
    });
}
