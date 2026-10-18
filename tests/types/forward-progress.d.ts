/** Exact read-only browser contract; negative inputs still reach runtime checks. */
declare module '*web/forward-progress-client.mjs' {
  export interface ForwardProgressAsset {
    chainId: string; contract: string; tokenId: string;
  }
  export interface ForwardProgressRequest {
    asset: ForwardProgressAsset; sequenceId: string;
  }
  export type ForwardProgressTrack = {
    state: 'observed'; position: string; changedThrough: string;
    unchangedThrough: string; untradedThrough: string;
    ratio: { numerator: string; denominator: string };
  } | {
    state: 'unavailable'; position: null; changedThrough: null;
    unchangedThrough: string; untradedThrough: string; ratio: null;
  };
  export interface ForwardProgress extends ForwardProgressRequest {
    schema: '8415-forward-progress/1'; userPosition: string; sourceRevision: string;
    blockNumber: string; blockHash: string; knownEnd: string; scaleEnd: string;
    state: 'UNAVAILABLE' | 'DONE' | 'PENDING';
    owner: ForwardProgressTrack; holder: ForwardProgressTrack;
    funds: { state: 'not-evaluated' }; rollback: { state: 'not-evaluated' };
    protocolFinality: boolean | null; commercialExecution: 'not-evaluated';
    canExecute: false; recordRevision: string; frozen: boolean;
  }
  export function forwardProgressRequest(input: unknown, chainId: unknown): ForwardProgressRequest;
  export function validateForwardProgress(value: unknown, input: ForwardProgressRequest): ForwardProgress;
}

declare module '*web/locales/forward-progress.mjs' {
  export type ForwardProgressLocale = 'en' | 'zh-Hans' | 'zh-Hant' | 'fr' | 'es' | 'ja';
  export type ForwardProgressText = readonly [
    title: string, read: string, unavailable: string, owner: string, holder: string,
    done: string, pending: string, funds: string, rollback: string, finality: string,
    notEvaluated: string, yes: string, no: string, disclosure: string,
  ];
  export const FORWARD_PROGRESS_TEXT: Readonly<Record<ForwardProgressLocale, ForwardProgressText>>;
}
