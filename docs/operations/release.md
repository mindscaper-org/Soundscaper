# Release policy

Soundscaper is an owner-run hobby project. Pushing the stable tag is the owner's
release decision. There is no certification, admission authority, reviewer
signature, evidence register, fixed lab campaign, or waiver process.

## What automation establishes

Automated tests establish only what actually ran and passed on their reported
source revision and environment. A stable-tag run repeats the normal static,
Node, browser, native-build, package, and smoke checks before assembling the
release. Deterministic correctness failures block that workflow. Performance
diagnostics report useful trends without claiming that one machine represents
every user's hardware.

SHA-256 inventories, pinned sources, package-content checks, and runtime payload
authentication remain ordinary integrity controls. They detect accidental or
hostile byte substitution; they do not constitute a signed release approval.

## Manual QA

The evergreen [Soundscaper](qa/soundscaper.md) and
[Framescaper](qa/framescaper.md) worksheets help the owner exercise workflows
that benefit from human observation. Completed copies are local, ignored files.
Manual QA is never read as a CI gate and no script converts it into release
readiness.

Do not release with a known data-loss, security, or primary-workflow failure.
Everything else—including which conditional environments to try and whether a
bounded issue is acceptable—is an explicit owner decision.

## Version metadata

To create the next Soundscaper RC locally, run:

```sh
npm run release:soundscaper:rc
```

The command uses the machine's local year, English month abbreviation, day,
and the next build letter: `Soundscaper-rc.2026.Nov.11.a`, then `.b`, through
`.z`, `.aa`, and so on. A new date starts at `.a`. It advances past existing
local Soundscaper tags for that date across all channels. Framescaper retains
its independent release line.

It synchronizes metadata, stages all nonignored changes (including new files
and deletions), commits them, and creates an annotated tag equal to the release
name. Finish any merge, rebase, or other Git operation first. The command prints
the exact push command and leaves pushing to you:

```sh
git push --atomic origin HEAD refs/tags/Soundscaper-rc.2026.Nov.11.b
```

If a commit hook fails, changes remain staged and no tag is created. A tag
failure preserves the release commit and prints the command for tagging it.

`config/product-release-lines.json` is the version authority. Schema 3 uses
named calendar releases exclusively:

- Stable: `Soundscaper.2026.Nov.11.a`.
- Preview: `Soundscaper-alpha.2026.Nov.11.a`, `Soundscaper-beta.2026.Nov.11.a`,
  or `Soundscaper-rc.2026.Nov.11.a`.
- Framescaper uses its own name with the same date and channel grammar.

Prepare any channel with `npm run release:soundscaper:prepare -- <release-name>`.
The tag is exactly that release name. The command selects the channel and
synchronizes the register, `package.json`, both root lockfile version fields,
and `desktop/product.json`. Run it without a version to synchronize an edited
register, or with `--check` to check without writing. Commit these files together.

Public versions, download filenames, application diagnostics, and update checks
use the full calendar name. Numeric package fields required by npm,
electron-builder, Apple, Debian, and Windows are derived mechanically as
`year.MMDD.revision`. The revision is four times the zero-based build-letter
ordinal plus the channel rank: alpha 0, beta 1, rc 2, stable 3. Thus
`Soundscaper-rc.2026.Nov.11.a` has package version `2026.1111.2`, and its next
RC build has `2026.1111.6`. Date, build-letter, and channel order stay identical
in every package format. Native 16-bit revision fields permit 16,384 build
letters per day; larger values are rejected before metadata is written.
`package.json.releaseVersion` and the desktop product metadata retain the public
name. The desktop checks the numeric installed package version against its
metadata and supplies the public name to the editor and updater.

Preview tags run the desktop preview workflow, including alpha and beta.
Stable `Soundscaper.<year>.<month>.<day>.<build>` tags run the stable publishing
workflow. Publication remains an explicit push by the owner. Historical
schema-2 metadata and old downloads remain readable for existing installations.
An installed checker that understands only historical semantic tags needs a
manual first upgrade to a build with calendar-tag support.

## FFmpeg runtime assets

Keep FFmpeg runtime assets outside the Pages bundle. Their versioned publication
namespace is `https://assets.soundscaper.org/runtime/ffmpeg/`. The production
browser does not fetch or publish this retained runtime; the
[technical deployment guide](../../Technical_README.md#1-retained-legacy-ffmpeg-publication-tooling)
documents the historical publication tooling and its current restrictions.

## Stable release sequence

1. Run the ordinary development and browser checks and use a local QA worksheet
   when human verification is useful.
2. Prepare the version metadata with
   `npm run release:soundscaper:prepare -- <version>` and commit that change.
3. Push the matching stable tag. The tag workflow rebuilds and tests that exact
   revision, creates packages with the configured signing mode, verifies their integrity, deploys the
   site, and publishes the GitHub release.
4. If a serious defect appears, remove or disable the affected distribution,
   preserve user projects, fix the bug test-first, and publish a new version.

Framescaper keeps its independent tag namespace and release timing. Neither
product's release decision grants schema, storage, native-payload, or update
authority to the other.

## Desktop download links

The existing Download link and application menu open
`https://soundscaper.org/download/` (or `https://framescaper.org/download/`).
The server-rendered Pages Function lists the latest published RC for that
product, selected by publication date, with its version, date, release notes,
uploaded platform packages, checksums, source archive, and notices. Only
resources actually uploaded to that RC appear; unavailable platforms never
borrow packages from an older RC. Drafts, betas, stable releases, and releases
without a recognized installer are excluded. A failed lookup leaves a GitHub
release link and a retry action. No site rebuild is needed: both download
surfaces share a bounded GitHub lookup with a five-minute metadata edge cache.
The lookup uses Workers-compatible manual redirect handling and rejects all
non-success responses. The repository-ID API URL avoids owner-transfer redirects;
the runtime regression exercises both download handlers inside workerd, including
an upstream redirect, without contacting GitHub.
This route is independent of the Astro handbook's `/docs` base and loads no
editor JavaScript.

The version and publication date appear above the download heading. Packages
matching the request's desktop operating system and, when known, architecture
appear first; remaining packages stay in the native **Other downloads**
disclosure. A known operating system with an unknown processor shows that
platform's available architectures with a reminder to check the package name.
Unknown or unsupported devices can choose from **Other downloads**. Release
notes sit beside the checksums and source links. The page requests architecture
and bitness client hints, uses the user agent when those hints are unavailable,
and varies its uncached HTML on that request information. Detection and the
disclosure work without JavaScript.

Vite development and preview servers run the same download-page handler through
`scripts/lib/vite-download-page.ts`, before the editor's SPA fallback. Local
requests use the selected `SCAPE_PRODUCT` (Soundscaper by default), so
`npm run preview` serves `/download/` at `http://localhost:4321/download/` and
`SCAPE_PRODUCT=framescaper npm run preview` selects Framescaper. Restart a
preview server after changing its server configuration; rebuilding editor
assets alone does not reload that configuration.

The existing `/download/desktop/` route remains available for direct downloads.
Its Pages Function selects the newest published release with an installer for the
request's desktop platform and architecture, including RCs and betas. Windows
downloads use the EXE installer, macOS downloads use the PKG installer, and Linux
downloads use the AppImage. Explicit links override browser detection and can
be shared or bookmarked:

| Package | Stable Soundscaper URL |
| --- | --- |
| Windows x64 installer | `https://soundscaper.org/download/desktop/soundscaper-windows-x64.exe` |
| Windows ARM64 installer | `https://soundscaper.org/download/desktop/soundscaper-windows-arm64.exe` |
| macOS Apple silicon installer | `https://soundscaper.org/download/desktop/soundscaper-mac-arm64.pkg` |
| Linux x64 AppImage | `https://soundscaper.org/download/desktop/soundscaper-linux-x64.AppImage` |
| Linux ARM64 AppImage | `https://soundscaper.org/download/desktop/soundscaper-linux-arm64.AppImage` |

macOS DMGs, Windows ZIPs and Linux `.deb` and `.flatpak` packages use the same
URLs with the matching extension. Framescaper uses `framescaper.org` and the `framescaper-`
filename prefix. Redirects resolve on each visit, with a five-minute edge cache
on GitHub release metadata, and preserve the versioned package filenames.

Unknown platforms and architectures (including Macs whose browser hides the
chip architecture) open the latest product release page. A missing matching
package also falls back to that page; a failed GitHub lookup opens the product's
release search. Only uploaded assets matching the requested product, version,
platform, and architecture can be direct download destinations.

See [Desktop signing setup](signing.md) for Developer ID,
notarization, Windows signing, and the GitHub secrets and variables to configure
before enabling signed release builds.
