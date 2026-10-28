import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SKILLS_DIR, MARKER } from './paths.js';

// Skills the factory flow invokes; the model must be able to call them, so upstream's
// disable-model-invocation flag is removed from their copies.
function invokedByFactory(skillsDir) {
  const flow = fs.readFileSync(path.join(skillsDir, 'factory', 'SKILL.md'), 'utf8');
  return new Set([...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One Markdown file of a shipped skill: set the name and rewrite `/from` mentions when renamed,
// and drop the model-invocation flag when the factory has to call the skill.
function rewrite(text, { skillFile, from, to, unflag }) {
  if (from !== to) {
    if (skillFile) text = text.replace(/^name:.*$/m, () => `name: ${to}`);
    text = text.replaceAll(new RegExp(`/${escapeRegExp(from)}(?![\\w-])`, 'g'), () => `/${to}`);
  }
  return unflag ? text.replace(/^disable-model-invocation:.*\n/m, '') : text;
}

const leaves = (base, target) => path.relative(base, target).startsWith('..') || path.isAbsolute(path.relative(base, target));

// Copies the skills listed in the manifest from the vendor submodules into skills/.
// An entry is a path, or { path, as } to ship the skill under another name.
// Our own skills (no marker) are never touched.
export function sync({ root = ROOT, skillsDir = SKILLS_DIR } = {}) {
  const { skills } = JSON.parse(fs.readFileSync(path.join(root, 'skills.manifest.json'), 'utf8'));
  const invoked = invokedByFactory(skillsDir);
  // Validate every entry first, so a bad one leaves the skills folder untouched.
  const plan = skills.map((entry) => {
    const { path: rel, as: name = path.basename(rel) } = typeof entry === 'string' ? { path: entry } : entry;
    const src = path.join(root, rel);
    const dest = path.join(skillsDir, name);
    const bad = (why) => new Error(`manifest entry ${JSON.stringify(entry)} ${why}`);
    if (!/^[a-z0-9-]+$/.test(name)) throw bad('has an invalid shipped name (lowercase letters, digits and hyphens only)');
    if (leaves(root, src)) throw bad('leaves the repository');
    if (leaves(skillsDir, dest)) throw bad('leaves the skills folder');
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      throw new Error(`${rel} has no SKILL.md (run: git submodule update --init)`);
    }
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, MARKER))) {
      throw new Error(`skills/${name} is not synced from upstream; refusing to overwrite`);
    }
    // Shipped skills are plain files: a link could make the rewrite below touch files outside the skill.
    for (const e of fs.readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (e.isSymbolicLink()) throw new Error(`skill ${name} contains a symlink: ${path.relative(src, path.join(e.parentPath ?? e.path, e.name))}`);
    }
    return { rel, name, src, dest };
  });
  for (const { rel, name, src, dest } of plan) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    for (const f of fs.readdirSync(dest, { recursive: true }).filter((f) => f.endsWith('.md'))) {
      const file = path.join(dest, f);
      const skillFile = f === 'SKILL.md';
      fs.writeFileSync(file, rewrite(fs.readFileSync(file, 'utf8'), { skillFile, from: path.basename(rel), to: name, unflag: skillFile && invoked.has(name) }));
    }
    fs.writeFileSync(path.join(dest, MARKER), `${rel}\n`);
    console.log(`synced ${name}`);
  }
}
