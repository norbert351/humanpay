// Shared EIP-3009 (ERC-20 TransferWithAuthorization) typed-data builder.
// Both settlements produce the SAME gasless authorization shape so that a tip
// legally moves USAT from the SENDER's own wallet to the RECIPIENT's wallet
// (from != a central executor). The signature is verified by recovering the
// signer from `message.from` — i.e. the person who owns the sending wallet
// must sign; the bot never holds consolidated funds.
import { bytesToHex } from 'viem';
import { randomBytes, createHash } from 'node:crypto';

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
 * Build EIP-3009 TransferWithAuthorization typed-data.
 * @param {{ from: string, to: string, value: bigint|number|string, nonce?: string, domain: object }} p
 *   value is in ATOMIC units (6-decimals for USAT, like the on-chain token).
 * @returns viem typed-data (domain, primaryType, types, message)
 *
 * EIP-3009 requires a bytes32 nonce that the token marks as USED after a
 * successful transferWithAuthorization — reusing one makes the token revert
 * `TetherToken: auth invalid`. Callers often pass a non-bytes32 value (the P2P
 * handler passes `String(Date.now())`), and the old code silently substituted
 * ALL ZEROES: the first tip succeeded, then every later tip reused the consumed
 * zero nonce and failed. Always derive a REAL random bytes32 instead.
 */
function toBytes32Nonce(nonce) {
  if (typeof nonce === 'string' && /^0x[0-9a-fA-F]{64}$/.test(nonce)) return nonce;
  const seed = nonce === undefined || nonce === null ? '' : String(nonce);
  // 32 fresh random bytes are already a valid bytes32 nonce; mixing in the
  // caller's value keeps provenance debuggable without weakening uniqueness.
  const rand = randomBytes(32);
  const mixed = createHash('sha256').update(`${seed}:${rand.toString('hex')}:${Date.now()}`).digest('hex');
  return `0x${mixed}`;
}

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
      nonce: toBytes32Nonce(nonce),
    },
  };
}