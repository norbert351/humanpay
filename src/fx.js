// FX corridors — remittance / bill-pay in local stablecoins on Celo.
//
// The hackathon's stablecoin subtrack names Textile FX: on-chain FX liquidity on
// Celo mainnet swapping USD₮ against cNGN, wBRL, wARS. This module quotes a
// corridor and builds the swap intent. It is honest about its state: quotes come
// from a live source when one is configured (TEXTILE_FX_URL) and are otherwise
// reported as an estimate/scaffold — never presented as a live rate.
import { USAT } from './constants.js';

export const CORRIDORS = {
  NGN: { country: 'Nigeria', symbol: 'cNGN', kind: 'stablecoin' },
  BRL: { country: 'Brazil', symbol: 'wBRL', kind: 'wrapped' },
  ARS: { country: 'Argentina', symbol: 'wARS', kind: 'wrapped' },
};

/** Static reference rates ONLY as a labelled fallback estimate. */
const FALLBACK_USD_PER_LOCAL = { NGN: 1 / 1600, BRL: 1 / 5.4, ARS: 1 / 1050 };

/**
 * Quote USAT -> local (sell=USDT) or local -> USAT (buy=USDT) for a corridor.
 * Returns { source: 'live'|'estimate', ... } so callers can label honestly.
 */
export async function quote({ corridor, usatMicro, direction = 'sell', fxUrl = process.env.TEXTILE_FX_URL, fetchImpl = globalThis.fetch }) {
  const c = CORRIDORS[String(corridor || '').toUpperCase()];
  if (!c) throw new Error(`unknown corridor: ${corridor}`);
  const micro = BigInt(usatMicro || 0);
  const usd = Number(micro) / 1e6;

  if (fxUrl) {
    try {
      const url = `${fxUrl}?sell=${direction === 'sell' ? 'USDT' : c.symbol}&buy=${direction === 'sell' ? c.symbol : 'USDT'}`;
      const r = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const rate = Number(j.rate || j.price || j.mid);
        if (rate > 0) {
          const out = direction === 'sell' ? usd * (1 / rate) : usd * rate;
          return { corridor: corridor.toUpperCase(), symbol: c.symbol, direction, source: 'live', rate, usdIn: usd, localOut: +out.toFixed(2), token: USAT, url };
        }
      }
    } catch { /* fall through to labelled estimate */ }
  }
  const usdPerLocal = FALLBACK_USD_PER_LOCAL[corridor.toUpperCase()];
  const rate = direction === 'sell' ? usdPerLocal : 1 / usdPerLocal;
  const out = direction === 'sell' ? usd / usdPerLocal : usd * usdPerLocal;
  return {
    corridor: corridor.toUpperCase(), symbol: c.symbol, direction,
    source: 'estimate', note: 'reference estimate — set TEXTILE_FX_URL for a live on-chain quote',
    rate, usdIn: usd, localOut: +out.toFixed(2), token: USAT,
  };
}

/** Build a swap intent (same bounded-policy + settlement path as a tip). */
export function swapIntent({ corridor, usatMicro, direction = 'sell', recipient }) {
  const c = CORRIDORS[String(corridor || '').toUpperCase()];
  if (!c) throw new Error(`unknown corridor: ${corridor}`);
  return {
    type: 'fx_swap', corridor: corridor.toUpperCase(), symbol: c.symbol, direction,
    usatMicro: String(usatMicro), recipient: recipient ? String(recipient).toLowerCase() : null,
    steps: direction === 'sell'
      ? [`swap USAT→${c.symbol} on Celo`, 'deliver local stablecoin to recipient']
      : [`acquire ${c.symbol}`, `swap ${c.symbol}→USAT on Celo`, 'deliver USAT to recipient'],
  };
}
