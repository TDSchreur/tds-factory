import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SKILLS_DIR, MARKER } from './paths.js';

// Copies the skills listed in the manifest from the vendor submodules into skills/.
// Our own skills (no marker) are never touched.
export function sync() {
  const { skills } = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.manifest.json'), 'utf8'));
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
    fs.writeFileSync(path.join(dest, MARKER), `${rel}\n`);
    console.log(`synced ${path.basename(rel)}`);
  }
}
