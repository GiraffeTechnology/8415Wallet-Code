import { knownNarrative } from './renderNarratives.ts';
import { createRendererMessages, renderPresentationField, type RendererMessageFormatter } from './renderMessages.ts';
import type { AssetView } from './assetView.ts';
import { formatAddress, formatDuration, formatInstant, shortHex } from './format.ts';
import { wrapText } from './wrap.ts';
/**
 * Render the asset view as text.
 *
 * Layout carries meaning here. The position and the confirmed holder are given
 * equal weight under separate headings, each with its disclosure attached, so
 * neither can be skimmed as the answer to the other's question. The three
 * signals — finality, contest, and what the contract is — are separate blocks
 * for the same reason.
 */
export function renderAssetView(view: AssetView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const lines: string[] = [];
    const write = (text = '') => lines.push(text);
    const field = (label: string, value: string) => lines.push(`  ${label.padEnd(20)}${value}`);
    const wrap = (text: string) => {
        for (const line of wrapText(text, 74))
            write(`    ${line}`);
    };
    write(message("protocol.148", "Token {v0}  \u00B7  {v1}  \u00B7  chain {v2}", { v0: String(view.tokenId), v1: String(view.identity.address), v2: String(view.identity.chainId) }));
    write(message("protocol.149", "Observed at {v0}", { v0: String(formatInstant(view.observedAt)) }));
    write();
    write(message("protocol.150", "TRADEABLE POSITION", {}));
    field(message("protocol.151", "Owner", {}), formatAddress(view.tradeablePosition.owner));
    wrap(knownNarrative(view.tradeablePosition.disclosure, 'protocol.002', {}, message));
    write();
    write(message("protocol.152", "CONFIRMED HOLDER", {}));
    field(message("protocol.153", "Holder", {}), formatAddress(view.confirmedHolder.holder));
    field(message("protocol.154", "Admitted by", {}), message("protocol.155", "entry v{v0} of {v1}, effective {v2}", { v0: String(view.confirmedHolder.version), v1: String(view.confirmedHolder.entryCount), v2: String(formatInstant(view.confirmedHolder.effectiveAt)) }));
    field(message("protocol.156", "Commitment", {}), shortHex(view.confirmedHolder.recordCommitment));
    field(message("protocol.157", "Previous", {}), shortHex(view.confirmedHolder.previousCommitment));
    field(message("protocol.158", "Reference", {}), message("protocol.159", "{v0}  (opaque locator)", { v0: String(shortHex(view.confirmedHolder.registryReference)) }));
    wrap(knownNarrative(view.confirmedHolder.disclosure, 'protocol.003', {}, message));
    write();
    write(message("protocol.160", "ALIGNMENT  \u00B7  {v0}", { v0: String(view.alignment.aligned ? message("protocol.161", "agree", {}) : message("protocol.162", "diverged", {})) }));
    wrap(knownNarrative(view.alignment.note, view.alignment.aligned ? 'protocol.004' : 'protocol.005', {}, message));
    write();
    // The answer and how it stands against the rule are two separate facts: a
    // final present instant is legitimate while an admitted entry's effective
    // time is still ahead of it, so the qualifier carries the disagreement
    // rather than the word Final doing it.
    const finality = view.presentFinality;
    const standing = finality.agreement === 'consistent'
        ? ''
        : finality.agreement === 'disagrees'
            ? message('renderer.present.disagrees','  ·  disagrees with the rule',{})
            : message('renderer.present.boundary','  ·  boundary not obtained',{});
    write(message('protocol.163','FINALITY OF THE PRESENT  ·  {v0}',{v0:message(finality.final?'protocol.023':'protocol.024',finality.final?'Final':'Provisional',{})})+standing);
    const finalKey = finality.agreement === 'unverifiable' ? (finality.final ? 'protocol.present.unverifiableFinal' : 'protocol.present.unverifiableNotFinal')
      : finality.agreement === 'disagrees' ? (finality.final ? (finality.laterEntryAdmitted ? 'protocol.present.trueUncovered' : 'protocol.011') : 'protocol.present.falseDisagreement')
      : finality.final ? 'protocol.present.final' : finality.laterEntryAdmitted ? 'protocol.present.uncovered' : 'protocol.012';
    const finalValues = finality.agreement === 'unverifiable' || finalKey === 'protocol.011' ? {v0:String(finality.instant),v1:String(finality.latestEffectiveAt)}
      : finalKey === 'protocol.present.trueUncovered' ? {v0:String(finality.instant),v1:String(finality.coveredFrom)}
      : finalKey === 'protocol.present.uncovered' ? {v0:String(finality.instant),v1:String(finality.coveredFrom),v2:String(finality.latestEffectiveAt),v3:String(finality.coveredFrom)}
      : finalKey === 'protocol.012' ? {v0:String(finality.latestEffectiveAt)}
      : {v0:String(finality.latestEffectiveAt),v1:String(finality.instant),v2:String(finality.coveredFrom)};
    wrap(knownNarrative(renderPresentationField(finality, "explanation", message),finalKey,finalValues,message));
    write();
    write(message("protocol.164", "SETTLEMENT GAP  \u00B7  {v0}", { v0: String(view.gap.kind === 'unsupported' ? message('protocol.193','not offered by this contract',{}) : view.gap.kind === 'none' ? message('protocol.194','none open',{}) : message('protocol.001','open',{})) }));
    if (view.gap.kind === 'open') {
        field(message("protocol.165", "Settlement", {}), shortHex(view.gap.settlementId));
        field(message("protocol.166", "Opened at", {}), formatInstant(view.gap.openedAt));
        field(message("protocol.167", "Deadline", {}), formatInstant(view.gap.deadline));
        field(message("protocol.168", "Time remaining", {}), message("protocol.169", "{v0} of a {v1} period", { v0: String(formatDuration(view.gap.timeRemaining)), v1: String(formatDuration(view.gap.settlementPeriod)) }));
        field(message("protocol.170", "Expected holder", {}), formatAddress(view.gap.expectedHolder));
        field(message("protocol.171", "Initiator", {}), formatAddress(view.gap.initiator));
        field(message("protocol.172", "Contested from", {}), formatInstant(view.gap.contestedFrom));
        field(message("protocol.173", "Cancellable", {}), view.gap.cancellable ? message("protocol.174", "yes, the deadline has passed", {}) : message("protocol.175", "no, before deadline", {}));
    }
    wrap(knownNarrative(view.gap.note, view.gap.kind === 'unsupported' ? 'protocol.008' : view.gap.kind === 'none' ? 'protocol.009' : 'protocol.010', {}, message));
    write();
    write(message("protocol.176", "SETTLEMENT AUTHORITY", {}));
    if (view.authority.account !== undefined) {
        field(message("protocol.177", "Account", {}), formatAddress(view.authority.account));
    }
    // Three states, not two. `undefined` means the contract could not be asked,
    // and rendering that as "no" would report an answer nobody gave.
    field(message("protocol.178", "May open a gap", {}), view.authority.authorized === undefined
        ? message("protocol.179", "not reported", {}) : view.authority.authorized
        ? message("protocol.180", "yes", {}) : message("protocol.181", "no", {}));
    wrap(knownNarrative(view.authority.note, !view.conformance.settlement ? 'protocol.013' : view.authority.account === undefined ? 'protocol.014' : view.authority.authorized ? 'protocol.015' : 'protocol.016', {}, message));
    write();
    write(message("protocol.182", "CONTRACT IDENTITY", {}));
    field(message("protocol.183", "Register", {}), shortHex(view.identity.registerId));
    field(message("protocol.184", "Profile", {}), view.identity.verificationProfile === undefined
        ? message("protocol.185", "none \u2014 no settlement interface", {}) : shortHex(view.identity.verificationProfile));
    field(message("protocol.186", "Settlement period", {}), view.settlementPeriod === undefined
        ? message("protocol.185", "none \u2014 no settlement interface", {}) : message("protocol.187", "{v0} maximum for any one gap", { v0: String(formatDuration(view.settlementPeriod)) }));
    field(message("protocol.188", "Conformance", {}), [
        view.conformance.projection ? message('protocol.189','projection 0x6309e170',{}) : message('protocol.190','projection absent',{}),
        view.conformance.settlement ? message('protocol.191','settlement 0xf4a7d71b',{}) : message('protocol.192','settlement absent',{}),
    ].join('  ·  '));
    wrap(knownNarrative(view.identityNote, view.identity.verificationProfile === undefined ? 'protocol.007' : 'protocol.006', {}, message));
    return lines.join('\n');
}
