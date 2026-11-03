// How the PR provider adapters (ADR 0020) turn text from a host into text for the Dashboard: Check PR shows it as plain text.
// Every text comes from the host and is untrusted: it is returned as a plain string without control characters, cut to a fixed length, and a link only when it is https.
export const NAME_MAX = 120,
  PATH_MAX = 300,
  COMMENT_MAX = 300,
  LINK_MAX = 500,
  THREADS_MAX = 50,
  CHECKS_MAX = 50;
/** @param {unknown} v @param {number} max */
// Control, C1 and bidi/zero-width characters become spaces; a cut never splits a surrogate pair.
export const cut = (v, max) => {
  const text = (typeof v === 'string' ? v : '').replace(
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    ' ',
  );
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
};
/** @param {unknown} v @returns {string | null} */
export const link = (v) => {
  if (typeof v !== 'string' || v.length > LINK_MAX || /[\u0000-\u0020\u007f-\u009f]/.test(v)) return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    // Not a URL at all: no link.
    return null;
  }
};
