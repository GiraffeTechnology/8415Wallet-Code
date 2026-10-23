# Development Environment

This guide covers the retained embedded Kit. The sole current complete product
requirements are the [Wallet PRD](../ERC-8415-Wallet-PRD.md); the current
[engineering requirements](../../AGENTS.md) also apply.

## Requirements

Node 22.18 or newer. That is where Node runs TypeScript from source without a
flag, which lets the embedded Kit run directly from source. The containing Wallet
has runtime dependencies and separate build tasks; `package.json` is authoritative
for its dependencies and scripts. The Kit selector tests use the repository's own
Keccak implementation, not `ethereum-cryptography`. Python 3 is needed for the SDK checks.

## Commands

```sh
npm install
npm run verify      # typecheck + tests + EVM tests
npm run typecheck   # tsc --noEmit
npm test            # node --test
```

## Container

```sh
docker compose -f docker/compose.yaml run --rm wallet
```

## Layout

```
src/kit/api/       Kit Stage 1   HTTP surface: temporal routes, admission endpoint
src/kit/engine/    Kit Stage 1   projection kernel
                  Kit Stage 2   verification engine and proof profiles
                  Kit Stage 4   settlement composition
src/kit/adapters/  Kit Stage 3   chain abstraction, mock adapter first
contracts/        Kit Stage 3   frozen Solidity interfaces and identifier helpers
src/kit/sdk/       Kit Stage 5   JavaScript and Python SDKs
src/kit/console/   Kit Stage 6   institutional console
tests/kit/        embedded Kit tests
docker/           containing Wallet development container
```

## Rules that bind every stage

- finality is derived on query from admitted history, never stored as a flag;
- admitted history is append-only: no rewrite, no delete, no retroactive
  mutation of `effectiveAt`, commitment or holder;
- an open gap never blocks an ERC-721 transfer;
- commitment uniqueness is per token, never enforced across tokens;
- state names come from the standard: open gap / closed gap, provisional /
  final, admitted;
- the retained Kit console uses the engine and adapter layer. The Wallet's
  architecture separately requires direct chain reads for chain facts, as
  specified in Wallet PRD §§2.1–2.3.

The full current rule set is in [AGENTS.md](../../AGENTS.md).
