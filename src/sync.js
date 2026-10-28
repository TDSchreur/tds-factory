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
// An entry is a path, or { path, as } to ship the skill under another name.
// Our own skills (no marker) are never touched.
export function sync() {
  const { skills } = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.manifest.json'), 'utf8'));
  const invoked = invokedByFactory();
  for (const entry of skills) {
    const rel = typeof entry === 'string' ? entry : entry.path;
    const name = typeof entry === 'string' ? path.basename(rel) : entry.as;
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      throw new Error(`${rel} has no SKILL.md (run: git submodule update --init)`);
    }
    const dest = path.join(SKILLS_DIR, name);
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, MARKER))) {
      throw new Error(`skills/${name} is not synced from upstream; refusing to overwrite`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    const file = path.join(dest, 'SKILL.md');
    let text = fs.readFileSync(file, 'utf8');
    if (name !== path.basename(rel)) text = text.replace(/^name:.*$/m, `name: ${name}`);
    if (invoked.has(name)) text = text.replace(/^disable-model-invocation:.*\n/m, '');
    fs.writeFileSync(file, text);
    fs.writeFileSync(path.join(dest, MARKER), `${rel}\n`);
    console.log(`synced ${name}`);
  }
}
