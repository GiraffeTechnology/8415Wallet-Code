import {narrativeTemplate} from './renderNarratives.ts';
import { withPresentation, presentationMessage } from './renderMessages.ts';
import type { Instant, TokenId } from '../sdk/types.ts';
/**
 * How the wallet may describe finality.
 *
 * Four display states, because `isFinalAsOf` answering `false` means two
 * different things and the ERC's own wording keeps them apart. An instant
 * after the latest entry is covered by an answer that a later admission may
 * supersede — provisional. An instant before the first entry has no answer at
 * all — nothing there is provisional, because nothing resolved. `unavailable`
 * exists so a failed read never lands on either.
 */
export type FinalityDisplay = 'final' | 'provisional' | 'not-covered' | 'unavailable';
export type FinalityView = {
    readonly tokenId: TokenId;
    readonly instant: Instant;
    /** Exactly what `isFinalAsOf` returned. `undefined` when it could not be read. */
    readonly reported: boolean | undefined;
    readonly display: FinalityDisplay;
    readonly label: string;
    /** Why, in protocol terms. */
    readonly explanation: string;
    readonly firstEffectiveAt: Instant | undefined;
    readonly latestEffectiveAt: Instant | undefined;
};
const LABELS: Record<FinalityDisplay, string> = {
    final: 'Final',
    provisional: 'Provisional',
    'not-covered': 'Not final — the projection does not cover this instant',
    unavailable: 'Unavailable — no answer was obtained',
};
/**
 * Describe a finality answer.
 *
 * `reported` is taken from `isFinalAsOf` and is never second-guessed: this
 * function chooses wording and explains the boundary, it does not decide.
 * Where the reported answer contradicts the rule the ERC states, that is said
 * plainly rather than smoothed over — a contract that contradicts the rule is
 * worth seeing.
 */
export function describeFinality(input: {
    tokenId: TokenId;
    instant: Instant;
    reported: boolean | undefined;
    firstEffectiveAt: Instant | undefined;
    latestEffectiveAt: Instant | undefined;
    unavailableReason?: string;
}): FinalityView {
    const { tokenId, instant, reported, firstEffectiveAt, latestEffectiveAt } = input;
    const base = { tokenId, instant, reported, firstEffectiveAt, latestEffectiveAt };
    if (reported === undefined) {
        return withPresentation({
            ...base,
            display: 'unavailable',
            label: LABELS.unavailable,
            explanation: `No finality answer was obtained${input.unavailableReason === undefined ? '' : `: ${input.unavailableReason}`}. ` +
                'The wallet does not guess, and does not fall back to either answer.',
        }, {
            explanation: presentationMessage("protocol.027", "No finality answer was obtained{v0}. The wallet does not guess, and does not fall back to either answer.", { v0: String(input.unavailableReason === undefined ? '' : `: ${input.unavailableReason}`) }),
            label: presentationMessage("protocol.026", "Unavailable \u2014 no answer was obtained", {})
        });
    }
    const uncovered = firstEffectiveAt !== undefined && instant < firstEffectiveAt;
    const atOrAfterLatest = latestEffectiveAt !== undefined && instant >= latestEffectiveAt;
    const completeBounds = firstEffectiveAt !== undefined && latestEffectiveAt !== undefined;
    if (completeBounds && firstEffectiveAt > latestEffectiveAt) {
        return withPresentation({
            ...base,
            display: reported ? 'final' : 'provisional',
            label: reported ? 'Final — reported; entry boundaries inconsistent' :
                'Not final — reported; entry boundaries inconsistent',
            explanation: `The first entry's effective time (${firstEffectiveAt}) is after the ` +
                `latest entry's (${latestEffectiveAt}). The wallet preserves the reported ` +
                `answer (${reported}) but cannot explain it as a valid projection interval. ` +
                'These observations may be inconsistent; they are not legal finality.',
        }, {
            label: reported ? presentationMessage("protocol.finality.reversedFinal", "Final \u2014 reported; entry boundaries inconsistent", {}) : presentationMessage("protocol.finality.reversedNotFinal", "Not final \u2014 reported; entry boundaries inconsistent", {}),
            explanation: presentationMessage("protocol.finality.reversedExplanation", "The first entry's effective time ({v0}) is after the latest entry's ({v1}). The wallet preserves the reported answer ({v2}) but cannot explain it as a valid projection interval. These observations may be inconsistent; they are not legal finality.", { v0: String(firstEffectiveAt), v1: String(latestEffectiveAt), v2: String(reported) })
        });
    }
    if (reported) {
        const inconsistent = uncovered || atOrAfterLatest;
        const explanation = uncovered
            ? `The contract reports this instant as final although it precedes the first ` +
                `entry's effective time (${firstEffectiveAt}), which the finality rule does ` +
                `not allow. Treat these observations as inconsistent.`
            : atOrAfterLatest
                ? `The contract reports this instant as final although it is at or after the ` +
                    `latest entry's effective time (${latestEffectiveAt}). The final interval ` +
                    'ends strictly before that boundary. Treat these observations as inconsistent.'
                : !completeBounds
                    ? 'The contract reports this instant as final, but the first or latest entry ' +
                        'boundary was not obtained. The wallet preserves that answer without ' +
                        'claiming to have established its interval. This is not legal finality.'
                    : `No entry admitted in the future can change the holder at this instant: it ` +
                        `is at or after the first entry's effective time (${firstEffectiveAt}) ` +
                        `and strictly before the latest entry's (${latestEffectiveAt}). ` +
                        `This is finality of the projection's answer, not legal finality.`;
        const labelKey=inconsistent?'protocol.finality.inconsistentFinal':completeBounds?'protocol.023':'protocol.finality.unverifiedFinal';
        const explanationKey=uncovered?'protocol.028':atOrAfterLatest?'protocol.finality.trueAtLatest':!completeBounds?'protocol.finality.trueMissingBounds':'protocol.029';
        return withPresentation({ ...base, display: 'final' as const,
            label: inconsistent ? 'Final — reported; observations inconsistent' :
                completeBounds ? LABELS.final : 'Final — reported; interval not verified',
            explanation },{label:presentationMessage(labelKey,narrativeTemplate(labelKey)),explanation:presentationMessage(explanationKey,narrativeTemplate(explanationKey),
             uncovered?{v0:String(firstEffectiveAt)}:atOrAfterLatest?{v0:String(latestEffectiveAt)}:!completeBounds?{}:{v0:String(firstEffectiveAt),v1:String(latestEffectiveAt)})});
    }
    if (uncovered) {
        return withPresentation({
            ...base,
            display: 'not-covered',
            label: LABELS['not-covered'],
            explanation: `This instant precedes the first entry's effective time (${firstEffectiveAt}), so ` +
                `the projection resolves no holder for it. \`isFinalAsOf\` answers false here ` +
                `without reverting, which is what it is specified to do — it is not an error.`,
        }, {
            label: ({
                final: presentationMessage("protocol.023", "Final", {}),
                provisional: presentationMessage("protocol.024", "Provisional", {}),
                'not-covered': presentationMessage("protocol.025", "Not final \u2014 the projection does not cover this instant", {}),
                unavailable: presentationMessage("protocol.026", "Unavailable \u2014 no answer was obtained", {})
            })['not-covered'],
            explanation: presentationMessage("protocol.030", "This instant precedes the first entry's effective time ({v0}), so the projection resolves no holder for it. `isFinalAsOf` answers false here without reverting, which is what it is specified to do \u2014 it is not an error.", { v0: String(firstEffectiveAt) })
        });
    }
    if (!completeBounds) {
        return withPresentation({ ...base, display: 'provisional',
            label: 'Not final — reported; coverage not established',
            explanation: 'The contract reports false, but the first or latest entry boundary ' +
                'was not obtained. That answer alone does not distinguish an uncovered instant ' +
                'from a covered provisional one. The wallet does not invent either boundary ' +
                'or a holder from it. This is not a statement of legal finality.' }, {
            label: presentationMessage("protocol.finality.unverifiedNotFinal", "Not final \u2014 reported; coverage not established", {}),
            explanation: presentationMessage("protocol.finality.falseMissingBounds", "The contract reports false, but the first or latest entry boundary was not obtained. That answer alone does not distinguish an uncovered instant from a covered provisional one. The wallet does not invent either boundary or a holder from it. This is not a statement of legal finality.", {})
        });
    }
    if (!atOrAfterLatest) {
        return withPresentation({ ...base, display: 'provisional',
            label: 'Not final — reported; observations inconsistent',
            explanation: `The contract reports false although this instant is at or after ` +
                `the first entry's effective time (${firstEffectiveAt}) and strictly before ` +
                `the latest entry's (${latestEffectiveAt}). Those boundaries describe the ` +
                'final interval. The wallet preserves the false answer, flags the inconsistent ' +
                'observations, and does not present a normal provisional explanation.' }, {
            label: presentationMessage("protocol.finality.inconsistentNotFinal", "Not final \u2014 reported; observations inconsistent", {}),
            explanation: presentationMessage("protocol.finality.falseInsideInterval", "The contract reports false although this instant is at or after the first entry's effective time ({v0}) and strictly before the latest entry's ({v1}). Those boundaries describe the final interval. The wallet preserves the false answer, flags the inconsistent observations, and does not present a normal provisional explanation.", { v0: String(firstEffectiveAt), v1: String(latestEffectiveAt) })
        });
    }
    return withPresentation({
        ...base,
        display: 'provisional',
        label: LABELS.provisional,
        explanation: `This instant is at or after the latest entry's effective time ` +
            `(${latestEffectiveAt}), so a later admission may carry an earlier ` +
            `effective time and supersede this answer. It becomes final once an entry with a ` +
            `later effective time is admitted — including a confirming entry naming the same ` +
            `holder. This is not a statement of legal finality either way.`,
    }, {
        explanation: presentationMessage("protocol.031", "This instant is at or after the latest entry's effective time ({v0}), so a later admission may carry an earlier effective time and supersede this answer. It becomes final once an entry with a later effective time is admitted \u2014 including a confirming entry naming the same holder. This is not a statement of legal finality either way.", { v0: String(latestEffectiveAt) }),
        label: presentationMessage("protocol.024", "Provisional", {})
    });
}
