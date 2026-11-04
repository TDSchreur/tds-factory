// Waits for a condition instead of sleeping a fixed time: a fixed sleep is too short on a slow runner (Windows) and wastes time elsewhere.
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @template T
 * @param {() => T | Promise<T>} condition Polled until it returns something truthy.
 * @param {{ timeoutMs?: number, intervalMs?: number, message?: string }} [options]
 * @returns {Promise<Exclude<Awaited<T>, false | 0 | '' | null | undefined>>} The first truthy value.
 */
export async function waitUntil(condition, { timeoutMs = 5000, intervalMs = 20, message = 'condition not met' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await condition();
    if (value) return /** @type {Exclude<Awaited<T>, false | 0 | '' | null | undefined>} */ (value);
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`timed out after ${timeoutMs} ms: ${message}`);
    await delay(Math.min(intervalMs, left));
  }
}
