# The Dashboard adopts Fluent 2 through design tokens

The Dashboard is redesigned in Fluent 2 for v0.6.0. Fluent 2 is a design language; the Fluent UI libraries are one implementation of it. We had to choose between two ways to adopt it while keeping [ADR 0003](0003-preact-htm-dashboard.md) (Preact and htm, vendored, no build step): **A**, translate the Fluent 2 design tokens into the CSS variables of `dashboard/style.css` and hand-build the components, or **B**, vendor `@fluentui/web-components` v3 and use its custom elements in the Preact tree. We built the same card, button set (primary, secondary, subtle, outline, disabled) and drawer header both ways and looked at them in light and dark in headless Chromium.

**Decision: A.** Both options reach the same look. A costs far less to carry and leaves the rest of the Dashboard as it is.

**What B costs.** It works without a build step, which was the open question. `@fluentui/web-components` 3.1.3 (npm `latest`, MIT) ships one self-contained file, `web-components.min.js`: 274 KB, 66 KB gzipped, against 16 KB for all the files vendored today. Its elements worked inside Preact: `onClick`, `disabled` and `value` behaved, and the bundle loaded in about 40 ms. Against that:

- It is a minified blob that we would update by hand and could not review. The theme values it needs come from `@fluentui/tokens`, which is still `1.0.0-alpha.24`.
- Elements already in the HTML when the bundle loaded came out unstyled in our test; elements that Preact creates afterwards were styled. The Dashboard only does the second, but it is easy to get wrong.
- Light and dark switch only through `Fluent.setTheme(...)` in JavaScript, not through `prefers-color-scheme` in CSS, and the elements use shadow DOM, so our CSS cannot reach inside them.
- The library has no card, and the Dashboard needs a native `<dialog>` with its own focus trap. Only buttons, badges and progress bars would be replaced, and all six browser test files select native `button` elements.

**What A costs.** More hand-written CSS, and the components can drift from Fluent over time. The tokens remove most of the drift risk: they are Fluent's own values. We read `webLightTheme` and `webDarkTheme` from `@fluentui/tokens` 1.0.0-alpha.24 (459 tokens each) and kept the colour, radius, stroke, spacing, type, shadow and motion tokens the Dashboard can use. That subset of 139 tokens is about 16 KB of CSS for both themes, and fewer once the unused ones are dropped. The prototype used native `button` and `progress` markup, kept `prefers-color-scheme` and `data-theme` as they are today, and needed our own `forced-colors` rules for high contrast.

**How the restyle gets the tokens.** Run `npm pack @fluentui/tokens@1.0.0-alpha.24` in an empty folder, import `webLightTheme` and `webDarkTheme` from its `lib/index.js` (use `node --permission` with read access to that folder only), and write the tokens the Dashboard uses to `dashboard/style.css` under the names Fluent gives them (`--colorBrandBackground`, `--fontSizeBase300`, ...). Record the package and version in a comment above them. Do not copy the package into the repository.

**Fonts and licences.** Fluent's base font list starts with Segoe UI and continues with the system fonts (`-apple-system`, Roboto, Helvetica Neue, `sans-serif`). We use that list as it is and ship no font. Fluent's licence excludes its fonts and icons; we use neither. `@fluentui/web-components`, `@microsoft/fast-element` and `@fluentui/tokens` are all MIT. Only token values are copied, but they are copied from a package, so `THIRD-PARTY-NOTICES.md` carries the Microsoft MIT notice.

**When to look again.** If the Dashboard later needs menus, tabs, dropdowns or other components that are costly to hand-build and accessible by default in the library, B is a way to add them for those components only, with the tokens already in place. That would be a new ADR.
