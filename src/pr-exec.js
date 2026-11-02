import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { FactoryError } from './errors.js';

// The plumbing the PR provider adapters (see ADR 0020) share. The adapters name the command; only they ever run `gh` or `az`.

// Room for the JSON of a large PR.
export const MAX_BUFFER = 16 * 1024 * 1024;

// Runs a command without blocking the caller; resolves to { stdout, stderr } and rejects with the error execFile gives.
export const exec = promisify(execFile);

/**
 * Runs a command and waits for it, with its output as text.
 * @param {string} file
 * @param {string[]} args
 * @param {Omit<import('node:child_process').SpawnSyncOptionsWithStringEncoding, 'encoding'>} options
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export const spawnText = (file, args, options) => spawnSync(file, args, { encoding: 'utf8', ...options });

/**
 * The message of a failed synchronous run: its stderr, else why it did not start, else `fallback`.
 * @param {{ stderr?: string | null, error?: Error }} out
 * @param {string} fallback
 */
export const failureText = (out, fallback) => (out.stderr || out.error?.message || fallback).trim();

/**
 * An error a caller can tell apart by its `code`, the reason.
 * @param {string} message
 * @param {string} reason
 * @param {unknown} [cause]
 */
export const reasonError = (message, reason, cause) => new FactoryError(message, { code: reason, cause });

// A git remote URL as text, without the whitespace around it.
/** @param {unknown} remote */
export const remoteText = (remote) => String(remote).trim();
