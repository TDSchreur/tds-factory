// Helpers that read an unknown value without assuming its type.

/** The message of a value caught in a `catch`, which is not necessarily an Error: an Error's own, a string `message` of any object, else the value as text. @param {unknown} err */
export const messageOf = (err) =>
  err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string'
      ? err.message
      : String(err);

/** The `reason` of a failed PR lookup, or undefined. @param {unknown} err */
export const reasonOf = (err) =>
  typeof err === 'object' && err !== null && 'reason' in err && typeof err.reason === 'string' ? err.reason : undefined;

/** The `code` of a system error such as ENOENT, or undefined. @param {unknown} err */
export const codeOf = (err) =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : undefined;

/** The exit status and the standard error of a failed command run with execFileSync, as far as the error has them. @param {unknown} err */
export const execFailure = (err) => ({
  status: typeof err === 'object' && err !== null && 'status' in err ? err.status : undefined,
  stderr: typeof err === 'object' && err !== null && 'stderr' in err ? String(err.stderr ?? '') : '',
});

/**
 * Whether a value, possibly absent, is one of a list of strings.
 * @param {readonly string[]} list
 * @param {unknown} value
 */
export const oneOf = (list, value) => list.some((item) => item === value);
