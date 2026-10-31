/** Browser render helpers, no transaction capability. */
declare module '*web/locales/nft-browser.mjs' {
 export const NFT_BROWSER_TEXT: Readonly<Record<string,readonly string[]>>;
}
declare module '*web/coordination-render.mjs' {
 export function coordinationLines(value: unknown, locale?: string): string[];
 export function appendCoordinationView(root: unknown,value: unknown,document: unknown,locale?: string,includeLines?: boolean): void;
 export function appendForwardTracks(root: unknown,value: unknown,document: unknown,labels: readonly string[]): void;
}
