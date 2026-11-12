# Product handbooks

This workspace builds the public product documentation at
`https://soundscaper.org/docs` or `https://framescaper.org/docs`, selected by
`SCAPE_PRODUCT`. Product and engineering evidence in the repository's existing
`docs/` directory is intentionally not published here.

Each handbook is a path on its product origin, served by a separate static-assets
Worker, so it needs no additional DNS record or Pages project.
`scripts/lib/product-web-routing.mjs` owns the build and deployment base path.
The editor mirrors the two public origins and that base in its eager
documentation-link module, where importing the build-side routing code would
cross a lazy chunk boundary; tests hold that mirror, the Astro config, the
Cloudflare rules and the browser suite to the same routes.

The build also owns the product boundary. Soundscaper excludes the Framescaper
tutorial tree; Framescaper publishes only that tree and promotes it to the
handbook root. Links across the boundary point at the peer product's origin,
so neither site's navigation, search index, sitemap, or canonical URLs claim
the other product's tutorials.

Run commands from the repository root:

```sh
npm run docs:generate
npm run docs:check
npm run docs:dev
```

The generated reference pages are committed. Change one of the authoritative
runtime registries, run `npm run docs:generate`, and review the resulting
Markdown in the same pull request. `scripts/lib/docs-reference-generator.mjs`
is the only module that knows which registries exist; each page has its own
renderer under `scripts/lib/docs-reference/`, and a renderer is a pure function
of the values it is handed so a test can supply them.

A generated page never invents wording for a runtime identifier. Where an ID
was not written for readers, the renderer looks it up in a reviewed label map
and throws when it finds nothing, so a new capability, effect category, model
task, or package format fails `npm run docs:check` until somebody writes its
public name.

Local AI authoring and translation commands are optional maintainer tools. They
write draft files by default, record provenance, and never run in CI or a
Cloudflare build. Review their Git diff and revert output that is not suitable
for publication.

## Languages

The English pages are the source, and a language is a directory of the same
tree beside them: `src/content/docs/fr/` is the French handbook.
`scripts/lib/handbook-locales.mjs` reads which languages exist from those
directories, so translating a language's first pages is what publishes it and
deleting the directory withdraws it. Starlight fills a page a language has not
reached yet with the English one, so a language may be published while its
translation is still being written.

A directory is the lowercased tag - `pt-br`, not `pt-BR`. Astro lowercases the
slug it derives from a content path and Starlight reads the language out of
that slug, so a directory named `pt-BR` builds a duplicate English page tree
under a language that does not exist.

Translations are written by a local model:

```sh
npm run docs:translate:handbook -- --locale fr
npm run docs:translate:check
```

See `scripts/docs-ai/README.md`. The navigation the site is configured with -
the site title and the sidebar headings - is not part of any page, so it lives
in `scripts/lib/handbook-chrome.mjs` and one catalog per language under
`handbook/i18n/`; the same run translates it. Everything else in the sidebar is
a page's own frontmatter title and translates with the page.

## Page layouts

Pages use Starlight's standard reading layout by default. For wide comparisons
or other content that needs the available width beside the handbook navigation,
set this frontmatter preset:

```yaml
layoutPreset: full-width
```

The preset removes the article width limit and the expanding margins around
the article. The navigation and table of contents retain their normal widths,
and the mobile layout stays responsive. The comparison page at
`start/how-soundscaper-compares.md` uses this preset.

## Comparison cells

Use `+`, `~`, or `/` for supported, partial, or unavailable capabilities.
Missing features and capabilities supplied only by external plug-ins use `/`.
Hosting rows rate the ability to load the plug-in itself.

Keep visible labels short. Add ` :: ` after the label for an explanation shown
on hover, keyboard focus, or tap:

```markdown
| Native project | + — `.sscape` :: Media is bundled with the project. |
```

The table transform retains inline formatting and links each explanation to
its trigger with an accessible description. Escape or tapping elsewhere
closes the explanation.

Comparison tables fill the article with shared column widths. On narrow
screens, each table scrolls horizontally in a named, keyboard-focusable region.

## Authoring links

Write internal links root-absolute and base-free: `[Project files](/projects-and-data/project-files/)`.
`src/plugins/rehype-handbook-base.mjs` supplies the base and the page's own
language at build time, and `scripts/check-handbook-content.mjs` resolves the
base-free target against the page tree so a link to a page that does not exist
fails the check.

Frontmatter is the exception. A hero action's `link` is data read by a Starlight
component rather than Markdown a transform ever sees, so it has to carry the
base itself, and a translated page's has to carry the language too. The same
content check enforces that in the opposite direction, and the translator
writes the language in when it translates the page.

A heading that is linked to has to write its id out as `## Sharing programs
{#sharing-programs}`. Astro otherwise derives the id from the heading text,
which changes when the heading is translated, while a link destination is
protected during translation and keeps the English id. The content check
refuses an anchor that names a heading without a written-out id.

## Deployment

The **Handbook** GitHub Actions workflow checks, builds and publishes both
handbooks every Monday at 04:43 UTC. Use **Actions > Handbook > Run workflow**
on `main` for an earlier update. Pushes and pull requests do not generate or
publish handbooks. Handbook-only changes under `handbook/` or `docs/` do not
start the product Quality or desktop test-artifact workflows.

Publication has no dependency on product CI. `wrangler.handbook.jsonc` owns two
static-assets Workers, `soundscaper-handbook` and `framescaper-handbook`, routed
only to each product's `/docs` and `/docs/*`. The existing editor Pages projects
continue to own the other paths. Product builds, quality checks and deployments
do not rebuild or stage a handbook.

The workflow uses the existing `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` secrets. The token needs account **Workers Scripts: Edit**
and zone **Workers Routes: Edit** for `soundscaper.org` and `framescaper.org`
(see [Workers deployment permissions](https://developers.cloudflare.com/workers/authorization/workers/)),
in addition to its existing Pages permissions. The first manual or scheduled
run creates the Workers and installs their routes; until that run, the existing
Pages deployment continues serving its previous handbook.
Product publication checks that the independent route is active before
deploying an editor build without a bundled handbook, so run **Handbook** once
after this workflow is first pushed. Later product deployments preserve the
Worker's existing handbook without rebuilding it.

To prepare and review one deployment locally, select the same product for the
build, staging and Wrangler environment:

```sh
SCAPE_PRODUCT=soundscaper npm run docs:check
SCAPE_PRODUCT=soundscaper node scripts/prepare-handbook-deploy.mjs
npx wrangler deploy --config wrangler.handbook.jsonc --env soundscaper --dry-run
```

Staging writes only documentation assets under `.wrangler/handbook-site/docs`,
with the existing isolation, permission and cache headers and retired handbook
redirects. Each deployment is verified against the exact checked index bytes.

Staging fails closed rather than deploying something broken: a `handbook/dist`
built for a different base path or product origin is refused, because Astro
bakes both into the output and a stale build can look complete while its links
and stylesheets point somewhere the deployment does not serve.

The Handbook workflow runs the reference/content checks and both product builds.
Its Soundscaper job also runs the existing desktop and mobile handbook browser
workflows before publication. Local AI authoring and translation remain manual.

Keep Cloudflare Web Analytics disabled so the deployed site continues to match
the handbook's static, first-party-only privacy statement.
