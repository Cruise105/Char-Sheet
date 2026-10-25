// Dungeon Master mode only turns on for the DM's own Google account.
// The address is stored scrambled (a SHA-256 fingerprint), so it isn't readable in the public code.
// To hand DM duties to another account, replace the fingerprint (see README, "Changing the DM account").
export const DM_EMAIL_HASH = 'b125bb8385b95a62660dd114a3bba67b77ca689e24cd6806bfe066b1f453f713';

export async function isDmEmail(email) {
  if (!email || !globalThis.crypto?.subtle) return false;
  const data = new TextEncoder().encode(String(email).trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === DM_EMAIL_HASH;
}
