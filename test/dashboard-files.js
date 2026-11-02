import { readFileSync } from 'node:fs';

/** @param {string} name */
const read = (name) => readFileSync(new URL(`../dashboard/${name}`, import.meta.url), 'utf8');

export const index = read('index.html');
export const css = read('style.css');
