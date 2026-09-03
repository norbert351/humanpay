// ERC-8021 attribution wrapper around @celo/attribution-tags.
// Every HumanPay settlement appends the assigned tag to calldata so the
// Celo leaderboard credits it. Only the ASSIGNED tag counts.
import { toDataSuffix, fromDataSuffix } from '@celo/attribution-tags';
import { ATTRIBUTION_TAG } from './constants.js';

export const TAG = ATTRIBUTION_TAG;
export const SUFFIX = () => toDataSuffix([TAG]);

/** Append the attribution suffix to an existing 0x calldata string. */
export function taggedCall(calldataHex) {
  const data = calldataHex.startsWith('0x') ? calldataHex : `0x${calldataHex}`;
  const suffix = SUFFIX().slice(2); // strip 0x
  return data + suffix;
}

/** Decode any attribution codes present in calldata (for `verifyTx`-style checks). */
export function codesIn(calldataHex) {
  const parsed = fromDataSuffix(calldataHex);
  return Array.isArray(parsed) ? parsed : (parsed && parsed.codes) || [];
}