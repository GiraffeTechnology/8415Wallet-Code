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
