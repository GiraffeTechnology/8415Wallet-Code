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
  export function declarationFile(): { size: number; text(): Promise<string> };
}
