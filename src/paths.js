import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const MARKER = '.tds-factory';
export const AGENTS_DIR = path.join(ROOT, 'agents');
