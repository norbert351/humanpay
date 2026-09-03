// Self proof-of-personhood gate — the anti-sybil lane judges named.
// Two implementations behind one seam (per the seam-before-platform pattern):
//   * MockSelfGate  — demo/hermetic: proves the GATE is on the load-bearing path.
//   * SelfSDKGate   — real Self integration seam (pass a verified proof object).
export class MockSelfGate {
  async verify(_proof) {
    return { ok: true, human: 'zubby_crypt1', sessionId: 'sess-demo' };
  }
}

export class SelfSDKGate {
  /** Real Self integration seam. wire() would call the deployed Self verifier. */
  async verify(proof) {
    if (!proof || typeof proof !== 'object' || !proof.nullifier) {
      throw new Error('SELF: missing proof (nullifier) — real Self integration pending wiring');
    }
    return { ok: true, human: `self:${proof.nullifier.slice(0, 8)}…`, sessionId: `self-${proof.nullifier.slice(0, 16)}` };
  }
}

export { SelfSDKGate as SelfGate };