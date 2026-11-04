// @ts-check

// A link from the tracker is untrusted text: control characters, format characters (bidi, zero-width, ZWJ) and the line and paragraph separators become a space, so a link stays on one line and cannot hide or reorder text. `run split` and the Dashboard split answer both print through it.
/** @param {string} text */
export const printable = (text) => text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ');
