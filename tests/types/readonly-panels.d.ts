declare module '*web/readonly-i18n.mjs' {
  export function readOnlyText(key: string, language?: string): string;
  export function readOnlyMessage(key: string): unknown;
  export function readOnlyPaint(element: any, key: string): void;
  export function readOnlyLabel(label: any, key: string, document?: any): any;
}

/**
 * The read-only panel mounts. Each returns a clear handle, or nothing when the
 * native host is absent, which is why the return type is optional.
 */
declare module '*web/audit-export-panel.mjs' {
  export function mountAuditExport(options: any): { clear(): void } | undefined;
}

declare module '*web/feed-continuity-panel.mjs' {
  export function mountFeedContinuity(options: any): { clear(): void } | undefined;
}

declare module '*web/kit-read-panel.mjs' {
  export function mountKitRead(options: any): { clear(): void } | undefined;
}

declare module '*web/watchtower-read-panel.mjs' {
  export function mountWatchtowerRead(options: any): { clear(): void } | undefined;
}

declare module '*helpers/readonly-panel-harness.mjs' {
  export const SECRET: string;
  export const CONTRACT: string;
  /** The minimal element the panels build against; see the harness source. */
  export class Node {
    id: string; className: string; textContent: string; hidden: boolean; disabled: boolean;
    value: string; type: string; accept: string; files: any[]; style: Record<string, string>;
    children: any[]; attributes: Map<string, string>; handlers: Map<string, ((event?: any) => void)[]>;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): string | null;
    removeAttribute(name: string): void;
    addEventListener(name: string, fn: (event?: any) => void): void;
    dispatchEvent(event: { type: string; detail?: unknown }): void;
    click(): void;
    append(...items: any[]): void;
    replaceChildren(...items: any[]): void;
    remove(): void;
    descendants(): any[];
  }
  export function fakeLogin(initial?: any): {
    assert(binding?: any): any; capture(): any; check(): Promise<void>;
    subscribe(fn: (session: any, reason: string) => void): () => void;
    provider(): any; logout(): void; expire(): void; subscriberCount(): number;
  };
  export function harness(): any;
  export function declarationFile(): { size: number; text(): Promise<string> };
  export function inputsOf(host: any, type: string): any[];
  export function runPanelLifecycleCases(panel: {
    label: string;
    mount: (options: any) => { clear(): void } | undefined;
    readKey: string;
    errorKey: string;
    prepare: (host: any) => void;
  }): void;
}
