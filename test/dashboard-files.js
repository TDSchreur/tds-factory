import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../dashboard/${name}`, import.meta.url), 'utf8');

export const index = read('index.html');
export const css = read('style.css');
export const markdownScript = read('markdown.js');
export const appScript = read('app.js');
// The page as one document, for tests that load it without the server.
export const html = index
  .replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`)
  .replace('<script src="/markdown.js"></script>', `<script id="markdown">${markdownScript}</script>`)
  .replace('<script src="/app.js"></script>', `<script>${appScript}</script>`);
