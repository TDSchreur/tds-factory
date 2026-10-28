// Prints the version of the next Release: major and minor of the package, patch one above the highest tag of that line.
// Usage: node scripts/next-version.js <package version> [tag...]
import { pathToFileURL } from 'node:url';

export function nextVersion(base, tags) {
  const line = /^(\d+)\.(\d+)\.\d+$/.exec(base);
  if (!line) throw new Error(`not a version: ${base}`);
  const tagged = new RegExp(`^v${line[1]}\\.${line[2]}\\.(\\d+)$`);
  const patches = tags.map((tag) => tagged.exec(tag)).filter(Boolean).map((m) => Number(m[1]));
  return `${line[1]}.${line[2]}.${patches.length ? Math.max(...patches) + 1 : 0}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(nextVersion(process.argv[2], process.argv.slice(3)));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}
