# Mansoldev Framework CSS

A modern CSS framework powered by Sass and PostCSS.

Inspired by **ITCSS** (*Inverted Triangle CSS*) but modernized with tokens and native themes.

## Node.js requirements

The installed CLI requires Node.js 20.12 or newer. To develop this repository or build the Astro documentation, use Node.js 24.15 or newer; `.nvmrc` selects the Node.js 24 line for development. The current Astro, Vite, and cssnano toolchain has a higher minimum than the CLI runtime.

## How to use:

For testing purpose:

```
pnpm run dev
```

Build ready to use:

```
pnpm run build
```

## Install and select a palette

Install the package in any JavaScript project:

```sh
npm install @mansoldev/framework
```

Initialize the detected project with the interactive palette picker, or pass a theme explicitly:

```sh
npx mansoldev-css init
npx mansoldev-css init --theme pastel
npx mansoldev-css list
```

`init` detects common Vite, Next.js, Angular, and Astro layouts. It generates a CSS entrypoint importing `core.css` plus the selected palette, then adds an import to a detected global stylesheet or module entrypoint. If no safe entrypoint is found, it prints the import path for you to add manually. This keeps consumers from downloading every palette just to use one.

Use `--out path/to/file.css` to choose another generated stylesheet path. Existing generated files are protected: the CLI asks before overwriting in an interactive terminal, or fails with instructions to use `--force` in automation. `--dry-run` prints planned changes without writing files.

Create an additional, independently importable theme stylesheet with `add`:

```sh
npx mansoldev-css add pastel
```

`add` writes the theme stylesheet next to the configured entrypoint and records it in `.mansoldevrc.json`; import that file when you want to activate the additional theme. The config records the CLI version and warns when a later CLI version finds an older config. The package exposes `@mansoldev/framework/core.css`, the complete showcase stylesheet as `@mansoldev/framework/framework.css`, individual palettes under `@mansoldev/framework/themes/`, and the source metadata in `@mansoldev/framework/manifest.json`.

For projects without a detected entrypoint, import the generated file from your JavaScript entry point:

```js
import './styles/mansoldev-framework.css';
```

The palette is fixed by the selected stylesheet. `data-theme="light"` or `data-theme="dark"` can independently force the color mode; without it, the browser's preferred color scheme is used. Components consume semantic variables such as `--brand`, `--surface`, `--border`, `--bg-body`, and `--text-main` rather than palette-specific colors.

Each palette also exposes its complete raw scale as CSS custom properties, for example `var(--mu-color-brand-500)`, `var(--mu-color-brand-700)`, and `var(--mu-color-accent-300)`. These are useful for one-off product styling; framework components should continue to use semantic variables.

The Astro documentation loads all palettes and uses `data-palette="neon"` or `data-palette="pastel"` for its live palette selector. Consumer projects do not need that selector.

## Project structure

```text
bin/                         # npm CLI
scripts/                     # theme generation, clean, and website build
src/
    themes/manifest.json        # canonical theme names, metadata, and color scales
    themes/_root.scss           # shared semantic mapping and light/dark behavior
    tokens/_map-colors.scss     # Sass API backed by generated manifest data
    core.scss                   # framework layers without a color palette
    main.scss                   # complete showcase stylesheet
    _framework.scss             # shared ITCSS layers
website/                      # Astro documentation
index.html                    # optional Vite demo driven by the same manifest
dist/                         # generated package artifacts (not committed)
docs/                         # generated Astro site (not committed)
```

## Framework Architecture

The source follows the ITCSS layer order. Theme data has one editable source: `src/themes/manifest.json`. The build generates `_generated-colors.scss` from it because Sass does not load JSON natively; that generated file is ignored by Git and must not be edited by hand.

```text
src/
├── abstracts/                 # Sass-only tools such as functions and mixins (reserved layer; not populated yet)
├── tokens/
│   ├── _map-colors.scss       # Sass API; exposes the generated palette map and get-color()
│   ├── _generated-colors.scss # Build output from themes/manifest.json; do not edit
│   └── _map-spacing.scss      # Spacing scale exported as --mu-space-* custom properties
├── themes/
│   ├── manifest.json          # The only editable source for palette values and theme metadata
│   ├── _root.scss             # Shared color-scheme rules and semantic color mapping
│   ├── _core.scss             # Theme-independent color-scheme and spacing variables
│   └── _all.scss              # Emits selectors for every manifest palette; used by the showcase
├── generic/
│   └── _reset.scss            # Low-specificity reset and cross-browser defaults
├── base/
│   └── _elements.scss         # Defaults for HTML elements such as body and headings
├── layout/                    # Macro layout primitives (reserved layer; not populated yet)
├── components/
│   └── _button.scss           # Encapsulated, reusable component styles
├── utilities/
│   └── _generated.scss        # Generated spacing utility classes
├── _framework.scss            # Imports generic, base, components, and utilities in layer order
├── core.scss                  # Theme-independent variables plus _framework.scss
└── main.scss                  # All palette selectors plus _framework.scss; showcase/legacy entry
```

`core.css` is the lean consumer entry: framework layers without palette values. Import one `themes/<name>.css` alongside it. `framework.css` is the all-palettes showcase entry. Color groups and tones are emitted as `--mu-color-<group>-<tone>`; component-facing roles such as `--brand`, `--surface`, and `--border` are mapped once in `_root.scss`.

## Theme source and outputs

To add a theme, add one object to `src/themes/manifest.json` with a unique lowercase `name`, `label`, `description`, and complete family scales such as `blue`, `indigo`, `green`, `amber`, `red`, `slate`, and any other palette families you need for the design language. Then run `pnpm build:framework` (or `pnpm build`); the build validates each color and generates the Sass map, theme CSS, and distributed manifest. Astro imports the same JSON manifest to render its selector. Do not create a per-theme Sass file or add theme names to the CLI, Astro, or package exports.

The manifest is the single source of truth. Add or extend family groups directly in the manifest; the build script validates the actual scale shape instead of hardcoding legacy `brand`/`accent`/`neutral` arrays. The raw CSS variables are emitted generically; add a semantic role in `src/themes/_root.scss` only if framework components need to consume a family by role.

`src/tokens/_generated-colors.scss` will contain the same values after generation, but it is an output, not another source of truth. Editing it directly is temporary: the next `pnpm dev`, `pnpm build`, or `pnpm test` regenerates it from the manifest.

The build publishes:

- `@mansoldev/framework/core.css`: reset, base, components, utilities, spacing variables, and color-scheme behavior without a palette.
- `@mansoldev/framework/themes/<name>.css`: one palette's raw color scale and semantic variables.
- `@mansoldev/framework/framework.css`: the complete framework with every palette, intended for the documentation showcase and migration compatibility.
- `@mansoldev/framework/manifest.json`: validated theme metadata and color scales.

Palette and color mode are independent. `data-palette="<name>"` selects a palette in the showcase CSS; `data-theme="light"` or `data-theme="dark"` overrides the browser color scheme. Without `data-theme`, the browser preference is used.

## Development and builds

```sh
pnpm install
pnpm dev                 # Astro documentation
pnpm dev:root            # optional Vite demo
pnpm build               # framework package and static Astro docs
pnpm build:root          # optional Vite demo into temp/static-demo
pnpm test                # build artifacts and run CLI tests
```
