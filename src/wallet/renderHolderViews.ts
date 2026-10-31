import { knownNarrative, narrativeTemplate } from './renderNarratives.ts';
import { createRendererMessages, renderPresentationField, type RendererMessageFormatter } from './renderMessages.ts';
import type { AcquisitionDisclosure } from './acquisition.ts';
import type { CollisionReport } from './collisions.ts';
import { formatAddress, formatDuration, formatInstant, shortHex } from './format.ts';
import type { OwnershipHistoryView } from './ownershipHistory.ts';
import type { PostureView } from './posture.ts';
import type { RegistrationView } from './registration.ts';
import { wrapText } from './wrap.ts';
const WIDTH = 74;
function blockText(lines: string[], text: string, indent: string, translate: (text: string) => string): void {
    for (const line of wrapText(text, WIDTH))
        lines.push(`${indent}${line}`);
}
/** The holder-facing answer: what is happening, and whether they do anything. */
export function renderRegistration(view: RegistrationView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const block = (lines: string[], text: string, indent = '    ') => blockText(lines, text, indent, translate);
    const lines: string[] = [];
    lines.push(message("protocol.231", "REGISTRATION  \u00B7  {v0}", { v0: String(renderPresentationField(view, "headline", message)) }));
    lines.push('');
    block(lines, renderPresentationField(view, "meaning", message));
    lines.push('');
    lines.push(message("protocol.232", "  What you do", {}));
    block(lines, renderPresentationField(view, "action", message), '      ');
    if (view.registering !== undefined) {
        lines.push('');
        lines.push(message("protocol.233", "  Being registered now   {v0}", { v0: String(formatAddress(view.registering)) }));
        lines.push(message("protocol.234", "  More behind it         {v0}", { v0: String(view.furtherHopsBehind ? message("protocol.235", "yes \u2014 at least one further transfer", {}) : message("protocol.181", "no", {})) }));
    }
    if (view.commitmentWindow !== undefined) {
        lines.push('');
        lines.push(message("protocol.236", "  Agreed window          {v0}", { v0: String(formatInstant(view.commitmentWindow.deadline)) }));
        lines.push(`  ${view.commitmentWindow.passed ? message("protocol.237", "Passed", {}) : message("protocol.238", "Remaining", {}).padEnd(22)}${view.commitmentWindow.passed
            ? `                 ${message("protocol.239", "yes, {v0} ago", { v0: String(formatDuration(-view.commitmentWindow.remaining)) })}`
            : formatDuration(view.commitmentWindow.remaining)}`);
        lines.push('');
        block(lines, renderPresentationField(view.commitmentWindow,"note",message), '      ');
    }
    lines.push('');
    lines.push(message("protocol.240", "  Who to ask", {}));
    block(lines, renderPresentationField(view, "whoToAsk", message), '      ');
    return lines.join('\n');
}
/** Facts for a decision not yet made. Never a verdict. */
export function renderAcquisitionDisclosure(view: AcquisitionDisclosure, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const block = (lines: string[], text: string, indent = '    ') => blockText(lines, text, indent, translate);
    const lines: string[] = [];
    lines.push(message("protocol.241", "BEFORE YOU ACQUIRE  \u00B7  token {v0}", { v0: String(view.tokenId) }));
    lines.push('');
    lines.push(message("protocol.242", "  Position now     {v0}", { v0: String(formatAddress(view.position)) }));
    lines.push(message("protocol.243", "  Register says    {v0}", { v0: String(formatAddress(view.confirmedHolder)) }));
    lines.push('');
    for (const [pointIndex] of view.points.entries()) {
        const point = renderPresentationField(view.points,String(pointIndex),message);
        block(lines, `• ${point}`, '  ');
        lines.push('');
    }
    block(lines, renderPresentationField(view, "boundary", message), '  ');
    return lines.join('\n');
}
/** The pair, with stale as its own case. */
export function renderPosture(view: PostureView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const block = (lines: string[], text: string, indent = '    ') => blockText(lines, text, indent, translate);
    const lines: string[] = [];
    lines.push(message("protocol.244", "POSTURE  \u00B7  {v0}", { v0: String(renderPresentationField(view, "label", message)) }));
    lines.push('');
    block(lines, renderPresentationField(view, "explanation", message));
    lines.push('');
    lines.push(message("protocol.245", "  Projection", {}));
    block(lines, renderPresentationField(view, "projection", message), '      ');
    lines.push('');
    lines.push(message("protocol.246", "  Attestation feed", {}));
    block(lines, renderPresentationField(view, "feed", message), '      ');
    lines.push('');
    lines.push(message("protocol.247", "  Reference pattern (non-normative, not advice)", {}));
    block(lines, renderPresentationField(view, "referencePattern", message), '      ');
    lines.push('');
    block(lines, renderPresentationField(view, "boundary", message), '  ');
    return lines.join('\n');
}
/** Collisions across the tokens examined, with the limit of the check stated. */
export function renderCollisions(report: CollisionReport, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const block = (lines: string[], text: string, indent = '    ') => blockText(lines, text, indent, translate);
    const lines: string[] = [];
    lines.push(message("protocol.248", "CROSS-TOKEN CHECK  \u00B7  {v0} token(s), {v1} entries", { v0: String(report.tokensExamined.length), v1: String(report.entriesExamined) }));
    lines.push('');
    if (report.collisions.length === 0) {
        lines.push(message("protocol.249", "  No collision among the tokens examined.", {}));
    }
    for (const collision of report.collisions) {
        lines.push(`  ${collision.crossToken ? message("protocol.250", "CROSS-TOKEN", {}) : message("protocol.251", "WITHIN ONE TOKEN", {})}  ${collision.kind}  ` +
            shortHex(collision.value));
        for (const occurrence of collision.occurrences) {
            lines.push(message("protocol.252", "      token {v0}  v{v1}", { v0: String(occurrence.tokenId), v1: String(occurrence.version) }));
        }
        const collisionKey=collision.kind==='recordCommitment'?'protocol.145':'protocol.146';
        const baseNote=narrativeTemplate(collisionKey);
        const note=collision.crossToken?knownNarrative(collision.note,collisionKey,{},message):
          collision.note===baseNote+' These occurrences are on one token, which invariant 4 forbids: the contract is not conforming.'?
          message('protocol.147','{v0} These occurrences are on one token, which invariant 4 forbids: the contract is not conforming.',{v0:message(collisionKey,baseNote,{})}):collision.note;
        block(lines,note,'      ');
        lines.push('');
    }
    lines.push('');
    block(lines,knownNarrative(report.scopeNote,'protocol.143',{},message),'  ');
    return lines.join('\n');
}
/** Both sequences on one timeline, with what each date means kept apart. */
export function renderOwnershipHistory(view: OwnershipHistoryView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const block = (lines: string[], text: string, indent = '    ') => blockText(lines, text, indent, translate);
    const lines: string[] = [];
    lines.push(message("protocol.253", "BOTH SEQUENCES  \u00B7  token {v0}  \u00B7  {v1} position change(s), {v2} entries", { v0: String(view.tokenId), v1: String(view.positionChanges), v2: String(view.entries) }));
    lines.push('');
    if (!view.available) {
        block(lines, knownNarrative(renderPresentationField(view, "note", message),view.available?'protocol.140':'protocol.139',{},message), '  ');
        return lines.join('\n');
    }
    for (const event of view.timeline) {
        if (event.kind === 'position') {
            lines.push(message("protocol.254", "  {v0}  \u00B7  POSITION  \u00B7  block {v1}", { v0: String(formatInstant(event.at)), v1: String(event.blockNumber) }));
            lines.push(event.minted
                ? message("protocol.255", "      minted to {v0}", { v0: String(formatAddress(event.to)) }) : `      ${formatAddress(event.from)}\n      →  ${formatAddress(event.to)}`);
        }
        else {
            lines.push(message("protocol.256", "  {v0}  \u00B7  REGISTER   \u00B7  entry v{v1}", { v0: String(formatInstant(event.at)), v1: String(event.version) }));
            lines.push(message("protocol.257", "      confirms {v0}", { v0: String(formatAddress(event.holder)) }));
            lines.push(message("protocol.258", "      commitment {v0}", { v0: String(shortHex(event.recordCommitment)) }));
        }
        lines.push('');
    }
    lines.push(message("protocol.259", "  Apparent correspondence", {}));
    for (const item of view.correspondences) {
        lines.push(`      ${formatAddress(item.to)}  ${item.state === 'outstanding'
            ? message("protocol.260", "not yet confirmed by any entry", {}) : message("protocol.261", "entry v{v0}, {v1} later", { v0: String(item.apparentEntry?.version), v1: String(formatDuration(item.lag ?? 0n)) })}`);
    }
    lines.push('');
    block(lines, knownNarrative(renderPresentationField(view, "note", message),view.available?'protocol.140':'protocol.139',{},message), '  ');
    lines.push('');
    block(lines, knownNarrative(view.caveat,'protocol.141',{},message), '  ');
    return lines.join('\n');
}
