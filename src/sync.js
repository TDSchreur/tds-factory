import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SKILLS_DIR, MARKER } from './paths.js';

// Skills the factory flow invokes; the model must be able to call them, so upstream's
// disable-model-invocation flag is removed from their copies.
function invokedByFactory() {
  const flow = fs.readFileSync(path.join(SKILLS_DIR, 'factory', 'SKILL.md'), 'utf8');
  return new Set([...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]));
}

// Copies the skills listed in the manifest from the vendor submodules into skills/.
// Our own skills (no marker) are never touched.
export function sync() {
  const { skills } = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.manifest.json'), 'utf8'));
  const invoked = invokedByFactory();
  for (const rel of skills) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      throw new Error(`${rel} has no SKILL.md (run: git submodule update --init)`);
    }
    const dest = path.join(SKILLS_DIR, path.basename(rel));
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, MARKER))) {
      throw new Error(`skills/${path.basename(rel)} is not synced from upstream; refusing to overwrite`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    if (invoked.has(path.basename(rel))) {
      const file = path.join(dest, 'SKILL.md');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^disable-model-invocation:.*\n/m, ''));
    }
    fs.writeFileSync(path.join(dest, MARKER), `${rel}\n`);
    console.log(`synced ${path.basename(rel)}`);
  }
}
