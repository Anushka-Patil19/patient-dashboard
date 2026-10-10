import crypto from 'node:crypto';
import { config } from '../config.js';

// Crockford base32 without I, L, O, U: easy to read aloud and write on a card.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generatePseudoId() {
  let id = '';
  for (let i = 0; i < 8; i += 1) id += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `PT-${id}`;
}

/**
 * Keyed hash of an external identifier (Aadhaar / ABHA / phone). The raw value
 * is never stored; the HMAC lets us detect a returning patient without being
 * reversible by anyone who lacks PSEUDONYM_SECRET (unlike a plain SHA-256 of a
 * 10-digit phone number, which is trivially brute-forced).
 */
export function hashExternalRef(raw) {
  const normalised = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!normalised) return null;
  return crypto.createHmac('sha256', config.pseudonymSecret).update(normalised).digest('hex');
}

export function ageBand(birthYear, onDate = new Date()) {
  const age = onDate.getUTCFullYear() - birthYear;
  if (age < 5) return '0-4';
  if (age < 15) return '5-14';
  if (age < 25) return '15-24';
  if (age < 45) return '25-44';
  if (age < 60) return '45-59';
  return '60+';
}
