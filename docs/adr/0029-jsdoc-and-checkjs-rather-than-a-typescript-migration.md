# Types come from JSDoc and checkJs, not from a TypeScript migration

The production code is checked by `tsc` under `strict` with `checkJs: true`, with the types written as JSDoc in the `.js` files. The Factory does not move to `.ts` files and has no build step.

The npm package ships its sources and runs them as they are. Node refuses to strip types from files under `node_modules`, so `.ts` sources in the package would need a compile step and a published `dist/`, which the install, sync and dev-install flows, the tests that read source text and the `files` list in `package.json` all assume does not exist. A compile step would also make a checkout differ from what runs.

JSDoc keeps the files runnable as written and lets `tsc` verify them with no emit. The trade-off is weaker ergonomics: typedefs are comments, generics and complex types are clumsier, and a cast needs the `/** @type {X} */ (expr)` form. To keep the check honest, a file has no `// @ts-nocheck`, `@ts-ignore` or `@ts-expect-error`, and a cast is allowed only where runtime narrowing already guarantees the type, never to silence a real mismatch. Shared shapes, such as the Run record, are `@typedef`s in one module and imported where used.

Three plain `tsc -p` projects cover the code (the root, `dashboard/` with DOM types and no Node types, and `test/`), chained in `npm run typecheck`; there is no `tsc --build`. `test/` keeps its opt-in `// @ts-check` behaviour until it follows in a later Run.
