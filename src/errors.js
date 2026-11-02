// The one way the Factory marks an error that a caller has to tell apart from the others.

/**
 * An error with a `code` a caller can check and the error that caused it, if any. The codes are lowercase and
 * kebab-case so they can never be taken for a Node system error code such as ENOENT.
 */
export class FactoryError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, cause?: unknown }} options
   */
  constructor(message, { code, cause }) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}
