import { knownNarrative } from './renderNarratives.ts';
import { createRendererMessages, renderPresentationField, type RendererMessageFormatter } from './renderMessages.ts';
import { formatAddress, formatInstant, shortHex } from './format.ts';
import type { RiskSurfaceView } from './riskSurfaces.ts';
import type { SettlementLogView } from './settlementLog.ts';
import { wrapText } from './wrap.ts';
/**
 * Render the gap history.
 *
 * Every episode shows how it ended and what that ending means, because the
 * three closures are not interchangeable and only one of them admitted
 * anything.
 */
export function renderSettlementLog(view: SettlementLogView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const lines: string[] = [];
    const coverage="Gap transitions returned by this reader for this token, and how each ended. A closure that admitted nothing is shown as such. Reader retention and omitted logs can limit coverage; this is not proof that every historical gap is present. When a settlement record cannot be read, its episode remains log-derived and openedAt stays unknown.";
    const write = (text = '') => lines.push(text);
    const wrap = (text: string, indent = '      ') => {
        for (const line of wrapText(text, 72))
            write(`${indent}${line}`);
    };
    write(message("protocol.222", "SETTLEMENT HISTORY  \u00B7  token {v0}", { v0: String(view.tokenId) }));
    if (!view.available) {
        write();
        wrap((view.available&&view.note===coverage?message('renderer.settlement.coverage',coverage,{}):knownNarrative(view.note,view.available?'protocol.134':'protocol.133',{},message)), '  ');
        return lines.join('\n');
    }
    write(message("protocol.223", "{v0} gap(s) on record", { v0: String(view.episodes.length) }));
    write();
    for (const episode of view.episodes) {
        write(`  ${shortHex(episode.settlementId)}  —  ${episode.closure}`);
        write(message("protocol.224", "      opened      {v0}", { v0: String(episode.openedAt === undefined ? message("protocol.225", "not read", {}) : formatInstant(episode.openedAt)) }));
        write(message("protocol.226", "      deadline    {v0}", { v0: String(formatInstant(episode.deadline)) }));
        write(message("protocol.227", "      expected    {v0}", { v0: String(formatAddress(episode.expectedHolder)) }));
        if (episode.admitted !== undefined) {
            write(message("protocol.228", "      admitted    entry v{v0}, effective {v1}", { v0: String(episode.admitted.version), v1: String(formatInstant(episode.admitted.effectiveAt)) }));
        }
        if (episode.replacedBy !== undefined) {
            write(message("protocol.229", "      replaced by {v0}", { v0: String(shortHex(episode.replacedBy)) }));
        }
        wrap(knownNarrative(renderPresentationField(episode, "meaning", message),({admitted:'protocol.129',cancelled:'protocol.130',superseded:'protocol.131','still-open':'protocol.132'} as const)[episode.closure],{},message));
        write();
    }
    wrap((view.available&&view.note===coverage?message('renderer.settlement.coverage',coverage,{}):knownNarrative(view.note,view.available?'protocol.134':'protocol.133',{},message)), '  ');
    return lines.join('\n');
}
/** Render the risk surfaces, as findings with their meaning and no verdict. */
export function renderRiskSurfaces(view: RiskSurfaceView, translate: (text: string) => string = text => text, format?: RendererMessageFormatter): string {
    const message = createRendererMessages(translate, format);
    const lines: string[] = [];
    const write = (text = '') => lines.push(text);
    const wrap = (text: string, indent = '      ') => {
        for (const line of wrapText(text, 72))
            write(`${indent}${line}`);
    };
    write(message("protocol.230", "RISK SURFACES  \u00B7  token {v0}  \u00B7  as of {v1}", { v0: String(view.tokenId), v1: String(formatInstant(view.observedAt)) }));
    write();
    for (const surface of view.surfaces) {
        write(`  ${surface.present ? '•' : '·'} ${renderPresentationField(surface, "heading", message)}`);
        wrap(renderPresentationField(surface, "finding", message));
        write();
        wrap(renderPresentationField(surface, "meaning", message));
        write();
    }
    wrap(renderPresentationField(view, "note", message), '  ');
    return lines.join('\n');
}
