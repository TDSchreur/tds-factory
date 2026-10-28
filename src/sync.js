import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SKILLS_DIR, MARKER } from './paths.js';

// Skills the factory flow invokes; the model must be able to call them, so upstream's
// disable-model-invocation flag is removed from their copies.
function invokedByFactory(skillsDir) {
  const flow = fs.readFileSync(path.join(skillsDir, 'factory', 'SKILL.md'), 'utf8');
  return new Set([...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]));
}

// Copies the skills listed in the manifest from the vendor submodules into skills/.
// An entry is a path, or { path, as } to ship the skill under another name.
// Our own skills (no marker) are never touched.
export function sync({ root = ROOT, skillsDir = SKILLS_DIR } = {}) {
  const { skills } = JSON.parse(fs.readFileSync(path.join(root, 'skills.manifest.json'), 'utf8'));
  const invoked = invokedByFactory(skillsDir);
  for (const entry of skills) {
    const { path: rel, as: name = path.basename(rel) } = typeof entry === 'string' ? { path: entry } : entry;
    const src = path.join(root, rel);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      throw new Error(`${rel} has no SKILL.md (run: git submodule update --init)`);
    }
    const dest = path.join(skillsDir, name);
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, MARKER))) {
      throw new Error(`skills/${name} is not synced from upstream; refusing to overwrite`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    const upstream = path.basename(rel);
    for (const f of fs.readdirSync(dest, { recursive: true }).filter((f) => f.endsWith('.md'))) {
      const file = path.join(dest, f);
      let text = fs.readFileSync(file, 'utf8');
      if (name !== upstream) {
        if (f === 'SKILL.md') text = text.replace(/^name:.*$/m, () => `name: ${name}`);
        text = text.replaceAll(new RegExp(`/${upstream}(?![\\w-])`, 'g'), `/${name}`);
      }
      if (f === 'SKILL.md' && invoked.has(name)) text = text.replace(/^disable-model-invocation:.*\n/m, '');
      fs.writeFileSync(file, text);
    }
    fs.writeFileSync(path.join(dest, MARKER), `${rel}\n`);
    console.log(`synced ${name}`);
  }
}
