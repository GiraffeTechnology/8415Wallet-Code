import { knownNarrative } from './renderNarratives.ts';
import { createRendererMessages, renderPresentationField, type RendererMessageFormatter } from './renderMessages.ts';
import { formatAddress, formatInstant, shortHex } from './format.ts';
import type { HistoryView } from './history.ts';
import type { TemporalView } from './temporalQuery.ts';
import { wrapText } from './wrap.ts';
/**
 * Render a temporal query.
 *
 * Resolution and finality get their own blocks, in that order, because they
 * are different questions. The tradeable position is last and labelled as
 * such, so it cannot be read as the answer.
 */
export function renderTemporalQuery(view: TemporalView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const lines: string[] = [];
    const write = (text = '') => lines.push(text);
    const field = (label: string, value: string) => lines.push(`  ${label.padEnd(18)}${value}`);
    const wrap = (text: string) => {
        for (const line of wrapText(text, 74))
            write(`    ${line}`);
    };
    write(message("protocol.148", "Token {v0}  \u00B7  {v1}  \u00B7  chain {v2}", { v0: String(view.tokenId), v1: String(view.identity.address), v2: String(view.identity.chainId) }));
    write(message("protocol.195", "As of        {v0}", { v0: String(formatInstant(view.instant)) }));
    write(message("protocol.196", "Queried at   {v0}", { v0: String(formatInstant(view.observedAt)) }));
    write();
    write(message("protocol.197", "CONFIRMED HOLDER AT THIS INSTANT", {}));
    switch (view.resolution.kind) {
        case 'resolved': {
            const { holder, entry, interval, holderAgreesWithEntry } = view.resolution;
            field(message("protocol.153", "Holder", {}), formatAddress(holder));
            field(message("protocol.154", "Admitted by", {}), message("protocol.155", "entry v{v0} of {v1}, effective {v2}", { v0: String(entry.version), v1: String(view.entryCount), v2: String(formatInstant(entry.effectiveAt)) }));
            field(message("protocol.198", "In force", {}), interval.until === undefined
                ? message("protocol.199", "from {v0} \u2014 still the latest entry", { v0: String(formatInstant(interval.from)) }) : message("protocol.200", "{v0}\n                    until {v1}", { v0: String(formatInstant(interval.from)), v1: String(formatInstant(interval.until)) }));
            field(message("protocol.156", "Commitment", {}), shortHex(entry.recordCommitment));
            field(message("protocol.157", "Previous", {}), shortHex(entry.previousCommitment));
            field(message("protocol.158", "Reference", {}), message("protocol.159", "{v0}  (opaque locator)", { v0: String(shortHex(entry.registryReference)) }));
            if (!holderAgreesWithEntry) {
                write();
                wrap(message("protocol.201", "holderAsOf returned {v0} while entryAsOf returned an entry whose holder is {v1}. The ERC requires these to agree; this contract is at fault and neither answer should be relied on.", { v0: String(holder), v1: String(entry.holder) }));
            }
            break;
        }
        case 'not-covered':
            field(message("protocol.153", "Holder", {}), message("protocol.202", "none \u2014 the projection does not cover this instant", {}));
            field(message("protocol.203", "First entry", {}), message("protocol.204", "effective {v0}", { v0: String(formatInstant(view.resolution.firstEffectiveAt)) }));
            wrap(knownNarrative(view.resolution.note, 'protocol.018', {}, message));
            break;
        case 'unavailable':
            field(message("protocol.153", "Holder", {}), message("protocol.017", "unavailable", {}));
            field(message("protocol.205", "Reason", {}), view.resolution.reason);
            wrap(knownNarrative(view.resolution.note, 'protocol.019', {}, message));
            break;
    }
    write();
    write(message("protocol.206", "FINALITY  \u00B7  {v0}", { v0: String(knownNarrative(renderPresentationField(view.finality, "label", message),view.finality.display==='unavailable'?'protocol.026':view.finality.display==='not-covered'?'protocol.025':view.finality.display==='final'?'protocol.023':'protocol.024',{},message)) }));
    const f = view.finality, first=f.firstEffectiveAt, latest=f.latestEffectiveAt;
    const bounds=first!==undefined&&latest!==undefined, reversed=bounds&&first>latest;
    const uncovered=first!==undefined&&f.instant<first, atLatest=latest!==undefined&&f.instant>=latest;
    const finalKey=f.reported===undefined?'protocol.027':reversed?'protocol.finality.reversedExplanation':f.reported?
      uncovered?'protocol.028':atLatest?'protocol.finality.trueAtLatest':!bounds?'protocol.finality.trueMissingBounds':'protocol.029':
      uncovered?'protocol.030':!bounds?'protocol.finality.falseMissingBounds':!atLatest?'protocol.finality.falseInsideInterval':'protocol.031';
    const finalParams:Readonly<Record<string,string>>=finalKey==='protocol.027'?{v0:''}:reversed?{v0:String(first),v1:String(latest),v2:String(f.reported)}:
      finalKey==='protocol.028'||finalKey==='protocol.030'?{v0:String(first)}:finalKey==='protocol.finality.trueAtLatest'||finalKey==='protocol.031'?{v0:String(latest)}:
      {v0:String(first),v1:String(latest)};
    wrap(knownNarrative(renderPresentationField(f, "explanation", message),finalKey,finalParams,message));
    write();
    // A separate block on purpose. Contest and finality answer different
    // questions, and a single combined badge would lose one of them.
    write(message("protocol.207", "CONTEST  \u00B7  {v0}", { v0: String(knownNarrative(view.contest.label,view.contest.display==='contested'?'protocol.032':view.contest.display==='not-contested'?'protocol.033':'protocol.034',{},message)) }));
    if (view.contest.openedAt !== undefined) {
        field(message("protocol.208", "Gap opened", {}), formatInstant(view.contest.openedAt));
        if (view.contest.deadline !== undefined) {
            field(message("protocol.167", "Deadline", {}), formatInstant(view.contest.deadline));
        }
        if (view.contest.settlementId !== undefined) {
            field(message("protocol.165", "Settlement", {}), shortHex(view.contest.settlementId));
        }
    }
    const contestKey = view.contest.display === 'no-gap-interface' ? 'protocol.035' : view.contest.openedAt === undefined ? 'protocol.036' : view.contest.display === 'contested' ? 'protocol.037' : 'protocol.038';
    wrap(knownNarrative(view.contest.explanation,contestKey,{v0:String(view.contest.openedAt)},message));
    write();
    write(message("protocol.209", "TRADEABLE POSITION (for contrast, not the answer)", {}));
    field(message("protocol.210", "Owner now", {}), formatAddress(view.tradeablePosition.owner));
    wrap(knownNarrative(view.tradeablePosition.disclosure,'protocol.020',{},message));
    return lines.join('\n');
}
/**
 * Render the append-only entry walk, newest first.
 *
 * Newest first because that is the order a reader scans; the entries
 * themselves are never reordered, and each carries its version so the
 * admission order stays readable.
 */
export function renderHistory(view: HistoryView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const lines: string[] = [];
    const write = (text = '') => lines.push(text);
    const wrap = (text: string, indent = '    ') => {
        for (const line of wrapText(text, 74))
            write(`${indent}${line}`);
    };
    write(message("protocol.211", "PROJECTION HISTORY  \u00B7  token {v0}  \u00B7  {v1} entries", { v0: String(view.tokenId), v1: String(view.entries.length) }));
    write(message("protocol.212", "Chain of commitments: {v0}", { v0: String(view.chainIntact ? message("protocol.fragment.intact", "intact", {}) : message("protocol.213", "BROKEN", {})) }));
    write();
    for (const item of [...view.entries].reverse()) {
        const { entry } = item;
        write(`  v${entry.version}  ${formatAddress(entry.holder)}`);
        write(message('protocol.214','      in force  {v0}{v1}',{v0:formatInstant(entry.effectiveAt),v1:item.intervalEnd===undefined ? message('protocol.215','  —  still the latest entry',{}) : message('protocol.216','\n                until {v0}',{v0:formatInstant(item.intervalEnd)})}));
        write(message("protocol.217", "      commitment  {v0}", { v0: String(shortHex(entry.recordCommitment)) }));
        write(message("protocol.218", "      previous    {v0}", { v0: String(entry.previousCommitment === `0x${'0'.repeat(64)}`
                ? message("protocol.219", "zero \u2014 first entry", {}) : shortHex(entry.previousCommitment)) }));
        write(message("protocol.220", "      reference   {v0}  (opaque locator)", { v0: String(shortHex(entry.registryReference)) }));
        if (item.linkFaults.length > 0) {
            write(message("protocol.221", "      FAULTS      {v0}", { v0: String(item.linkFaults.join(', ')) }));
        }
        write();
    }
    wrap(knownNarrative(renderPresentationField(view, "note", message),view.chainIntact?'protocol.127':'protocol.128',{},message), '  ');
    return lines.join('\n');
}
