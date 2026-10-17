import { requireProjectionConformance, requireSettlementConformance } from './conformance.ts';
import { IdentityChangedError } from './errors.ts';
import type { Erc8415Reader } from './port.ts';
import { ZERO_BYTES32, type Bytes32, type Conformance } from './types.ts';

/**
 * What a projection is a projection of.
 *
 * The parties who rely on this are third parties with no relationship to the
 * registrar, so a projection they cannot attribute to a register, under a
 * proof profile they cannot name, tells them very little. The wallet carries
 * these alongside every answer rather than treating them as configuration.
 */
export type ContractIdentity = {
  readonly chainId: bigint;
  readonly address: string;
  readonly registerId: Bytes32;
  /** Absent when the contract offers no settlement interface. */
  readonly verificationProfile: Bytes32 | undefined;
};

/**
 * Read and pin a contract's identity.
 *
 * `registerId` and `verificationProfile` are specified as nonzero and
 * unchanging. Re-reading them against a pin is therefore a real check: a
 * change means the wallet is not talking to the contract it believes it is,
 * and no displayed answer from it can be trusted.
 */
export class ContractIdentityPin {
  readonly #reader: Erc8415Reader;
  readonly #source: { readonly chainId: bigint; readonly address: string };
  #pinned: ContractIdentity | undefined;

  constructor(reader: Erc8415Reader) {
    this.#reader = reader;
    this.#source = Object.freeze({ chainId: reader.source.chainId, address: reader.source.address });
  }

  get pinned(): ContractIdentity | undefined {
    return this.#pinned;
  }

  /**
   * Read the identity, pinning it on first use and verifying it thereafter.
   *
   * A zero identifier is rejected rather than shown: the ERC requires both to
   * be nonzero, so a zero one means the contract is not answering the question
   * that was asked.
   */
  async read(conformance: Conformance): Promise<ContractIdentity> {
    this.#assertSource();
    requireProjectionConformance(this.#reader, conformance);

    const registerId = await this.#reader.registerId();
    this.#assertSource();
    if (!isNonzeroIdentifier(registerId)) {
      throw new IdentityChangedError('registerId', 'a nonzero bytes32 identifier', 'invalid bytes32 response');
    }

    let verificationProfile: Bytes32 | undefined;
    if (conformance.settlement) {
      requireSettlementConformance(this.#reader, conformance);
      verificationProfile = await this.#reader.verificationProfile!();
      this.#assertSource();
      if (!isNonzeroIdentifier(verificationProfile)) {
        throw new IdentityChangedError(
          'verificationProfile',
          'a nonzero bytes32 identifier',
          'invalid bytes32 response',
        );
      }
    }

    // All identity fields are primitives; freezing prevents callers from rewriting the pin.
    const observed: ContractIdentity = Object.freeze({
      chainId: this.#source.chainId,
      address: this.#source.address,
      registerId,
      verificationProfile,
    });

    const pinned = this.#pinned;
    if (pinned === undefined) {
      this.#pinned = observed;
      return observed;
    }

    if (pinned.registerId !== observed.registerId) {
      throw new IdentityChangedError('registerId', pinned.registerId, observed.registerId);
    }
    if (pinned.verificationProfile !== observed.verificationProfile) {
      throw new IdentityChangedError(
        'verificationProfile',
        pinned.verificationProfile ?? 'absent',
        observed.verificationProfile ?? 'absent',
      );
    }
    return observed;
  }

  #assertSource(): void {
    const current = this.#reader.source;
    if (current.chainId !== this.#source.chainId) {
      throw new IdentityChangedError(
        'chainId',
        String(this.#source.chainId),
        String(current.chainId),
      );
    }
    if (current.address.toLowerCase() !== this.#source.address.toLowerCase()) {
      throw new IdentityChangedError('address', this.#source.address, current.address);
    }
  }
}

/** Validate untrusted adapter values before they can establish an identity pin. */
function isNonzeroIdentifier(value: unknown): value is Bytes32 {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) &&
    value.toLowerCase() !== ZERO_BYTES32;
}
