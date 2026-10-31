declare module '*server/store-state-generation.mjs' {
  export function requiredStoreGeneration(records: unknown, minimum?: number): 1 | 2 | 3 | 4 | 5;
  export function encodeStorePayload(records: unknown, generation: number): unknown;
  export function decodeStorePayload(payload: unknown, generation: number): Record<string, unknown>;
}
