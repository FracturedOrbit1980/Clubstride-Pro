/**
 * Player profiles are shared by a short code, not by an account: a parent should not need to
 * install the app or remember a password to read their child's report. The code is therefore a
 * bearer credential for one player's profile - 8 characters from a 32-symbol alphabet (40 bits)
 * and looked up server-side by a SECURITY DEFINER function, so the tables stay closed to anon.
 *
 * I, O, 0 and 1 are not in the alphabet: codes get read off a printed PDF and typed on a phone.
 */

export const SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SHARE_CODE_LENGTH = 8;
export const SHARE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

/** Deployed Pro web build; the shared link opens the signed-out profile view there. */
export const PROFILE_WEB_BASE = 'https://fracturedorbit1980.github.io/Clubstride-Pro-Web/';

export type ShareCodeBytes = (length: number) => Uint8Array;

/**
 * getRandomValues, not Math.random. supabaseClient imports react-native-get-random-values, so
 * this exists on both platforms; if it ever does not, a failure is safer than issuing a guessable
 * code that would expose a child's profile.
 */
const secureBytes: ShareCodeBytes = length => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('No secure random source; refusing to generate a share code.');
  }
  return cryptoApi.getRandomValues(new Uint8Array(length));
};

/**
 * 256 is a multiple of 32, so a plain modulo is uniform here and no byte is wasted. A test can
 * inject bytes; production never should.
 */
export const generateShareCode = (bytes: ShareCodeBytes = secureBytes): string => {
  const raw = bytes(SHARE_CODE_LENGTH);
  let code = '';
  for (let index = 0; index < SHARE_CODE_LENGTH; index += 1) {
    code += SHARE_CODE_ALPHABET[(raw[index] ?? 0) % SHARE_CODE_ALPHABET.length];
  }
  return code;
};

/** Dashes, spaces and lower case are how a code arrives from a message or a keyboard. */
export const normaliseShareCode = (value: unknown): string =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export const isShareCode = (value: unknown): boolean =>
  SHARE_CODE_PATTERN.test(normaliseShareCode(value));

export const shareProfileWebLink = (code: string): string =>
  `${PROFILE_WEB_BASE}?player=${encodeURIComponent(normaliseShareCode(code))}`;

export const shareProfileDeepLink = (code: string): string =>
  `clubstride://player?code=${encodeURIComponent(normaliseShareCode(code))}`;

/**
 * Read by hand rather than with URLSearchParams: React Native only has that class once the URL
 * polyfill has run, and a code is alphanumerics, so there is nothing to percent-decode anyway.
 */
const queryParam = (text: string, key: string): string => {
  const start = text.indexOf('?');
  if (start < 0) return '';
  const query = text.slice(start + 1).split('#')[0] ?? '';
  for (const pair of query.split('&')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals) === key) return pair.slice(equals + 1);
  }
  return '';
};

/** Accepts the web link (?player=CODE), the deep link (?code=CODE) and a bare code. */
export const shareCodeFromUrl = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const queried = normaliseShareCode(queryParam(raw, 'player') || queryParam(raw, 'code'));
  if (queried) return SHARE_CODE_PATTERN.test(queried) ? queried : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const bare = normaliseShareCode(raw);
  return SHARE_CODE_PATTERN.test(bare) ? bare : null;
};

/** The message a coach sends with the PDF: name, link, and the code for anyone who prefers typing. */
export const shareProfileMessage = (playerName: string, code: string): string => {
  const name = playerName.trim() || 'Player';
  const normalised = normaliseShareCode(code);
  return [
    `${name}'s Clubstride player profile`,
    shareProfileWebLink(normalised),
    `Access code: ${normalised}`,
  ].join('\n');
};
