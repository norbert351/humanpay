// DEV-mode policy auth for P2P tips (signMessage over the canonical auth message).
// See policy.authMessage for the exact shape. Used only when a user binds their
// OWN key via /key — the signature proves the wallet owner signed this exact tip.
import { privateKeyToAccount } from 'viem/accounts';
import { authMessage } from './policy.js';

export async function signAuth(privateKey, req) {
  const account = privateKeyToAccount(privateKey);
  const message = { ...req };
  delete message.signature;
  delete message.from; // the auth message binds the request; `from` is implicit in the signer
  return account.signMessage({ message: authMessage({
    nonce: message.nonce,
    amountMicro: message.amountMicro,
    payTo: message.payTo,
    token: message.token,
    chainId: message.chainId,
    ts: message.ts,
  }) });
}