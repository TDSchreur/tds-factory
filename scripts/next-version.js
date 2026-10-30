// Prints the version of the next Release: major and minor of the package, patch one above the highest tag of that line.
// Usage: node scripts/next-version.js <package version> [tag...]
import { pathToFileURL } from 'node:url';

export function nextVersion(base, tags) {
  const line = /^(\d+)\.(\d+)\.\d+$/.exec(base);
  if (!line) throw new Error(`not a version: ${base}`);
  const prefix = `v${line[1]}.${line[2]}.`;
  const patches = tags
    .filter((tag) => tag.startsWith(prefix) && /^\d+$/.test(tag.slice(prefix.length)))
    .map((tag) => Number(tag.slice(prefix.length)));
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
