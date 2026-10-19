/** Test-facing declarations for the bounded JavaScript contracts. Inputs remain
 * unknown because negative fixtures deliberately exercise runtime validation. */
declare module '*server/task-test-nft721-contract.mjs' {
  export function encodeTestNFT721Mint(input: unknown): { to: string; data: string; valueWei: string };
}
declare module '*server/task-test-nft721-binding.mjs' {
  interface Deployment { schema: string; artifactDigest: string; chainId: string; collection: string;
    runtimeCodeHash: string; issuer: string; taskId: string; taskIdBytes32: string; }
  interface Binding { taskId: string; binding: Deployment; }
  interface MintResult { schema: string; taskId: string; sourceTaskId: string; taskIdBytes32: string; artifactDigest: string;
    chainId: string; collection: string; runtimeCodeHash: string; issuer: string; sourceHash: string; assetKind: 0 | 1;
    metadataHash: string; metadataURI: string; transactionHash: string; blockHash: string; blockNumber: string;
    tokenId: string; standard: 'ERC-721'; quantity: '1'; testOnly: true; finality: 'canonical-at-observed-block-not-finality'; }
  export function normalizeTestNFT721Bindings(input: unknown): readonly Binding[];
  export function testNFT721BindingForOperation(bindings: unknown, operation: unknown): Deployment;
  export function testNFT721OperationRequest(input: unknown): { taskId: string; taskIdBytes32: string } & Record<string, unknown>;
  export function normalizeTestNFT721OperationResult(input: unknown, operation: unknown, observation: unknown): MintResult;
  export function verifyTestNFT721OperationPreflight(input: unknown): Promise<{ to: string; valueWei: string }>;
  export function readTestNFT721OperationResult(input: unknown): Promise<MintResult>;
}
declare module '*server/task-test-nft721-metadata.mjs' {
  interface Readback { metadataHash: string; byteLength: number; sourceAuthenticity: false; institutionalSourceEvidence: false; }
  export function verifyTestNFT721Metadata(input: unknown): Promise<Readback>;
  export function createTaskNFT721MetadataVerifier(input: unknown): {
    readonly identity: { readonly configurationDigest: string };
    verify(operation: unknown): Promise<Readback>;
  };
}
declare module '*server/task-test-asset-authorization.mjs' {
  export function testMintInventoryKey(chainId: string, collection: string, sourceHash: string): string;
  export function createTaskTestAssetAuthorization(input: unknown): Promise<{
    allows(task: unknown): boolean; acceptCommittedMintRecord(record: unknown): void;
  }>;
}
