// Helpers that read an unknown value without assuming its type.

/** The message of a value caught in a `catch`, which is not necessarily an Error. @param {unknown} err */
export const messageOf = (err) => (err instanceof Error ? err.message : String(err));

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
