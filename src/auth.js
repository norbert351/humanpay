// Shared EIP-3009 (ERC-20 TransferWithAuthorization) typed-data builder.
// Both settlements produce the SAME gasless authorization shape so that a tip
// legally moves USAT from the SENDER's own wallet to the RECIPIENT's wallet
// (from != a central executor). The signature is verified by recovering the
// signer from `message.from` — i.e. the person who owns the sending wallet
// must sign; the bot never holds consolidated funds.
import { bytesToHex } from 'viem';

export const TRANSFER_WITH_AUTH_TYPE = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export const TRANSFER_AUTH_PRIMARY_TYPE = 'TransferWithAuthorization';

/**
 * Build the EIP-3009 typed-data for a gasless USAT transfer.
 * @param {{ from: string, to: string, value: bigint, nonce?: string, domain: object }} p
 *   value is in ATOMIC units (6-decimals for USAT, like the on-chain token).
 * @returns viem typed-data (domain, primaryType, types, message)
 */
export function transferAuthTypedData({ from, to, value, nonce, domain }) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    domain,
    primaryType: TRANSFER_AUTH_PRIMARY_TYPE,
    types: TRANSFER_WITH_AUTH_TYPE,
    message: {
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      value,
      validAfter: now - 1000n,   // tolerant of small clock skew
      validBefore: now + 3600n,  // 1 hour validity
      nonce: typeof nonce === 'string' && nonce.startsWith('0x') ? nonce : bytesToHex(new Uint8Array(32)),
    },
  };
}