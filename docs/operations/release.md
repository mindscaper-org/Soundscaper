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

The command keeps the active version's major, minor, and patch numbers and uses
the machine's local date with an English month abbreviation. A new day starts
at `1.0.0-rc.Oct.29.a`; another run that day advances to `.b`, then `.c`
(after `.z`, `.aa`). It also advances past matching local Soundscaper tags.
It synchronizes the version metadata, stages all nonignored changes in the
repository (including new files and deletions), commits them, and creates an
annotated `soundscaper-v<version>` tag on that commit. Framescaper's release
line is preserved. Finish any merge, rebase, or other Git operation first.

The command prints the exact push command and leaves pushing to you:

```sh
git push --atomic origin HEAD refs/tags/soundscaper-v1.0.0-rc.Oct.29.b
```

If a commit hook fails, the files and staged changes remain for correction and
no tag is created. If tagging fails after the commit succeeds, the command
prints how to tag that existing commit without creating another RC.

`config/product-release-lines.json` is the version authority for both products.
For Soundscaper, run `npm run release:soundscaper:prepare -- <version>` with a
plain stable version or a full `-rc.*` or `-beta.*` version. The command selects
the matching channel in the register and synchronizes `package.json`, both root
version fields in `package-lock.json`, and `desktop/product.json`. It prints the
matching tag and preserves Framescaper's independent release line.

If you edit the register directly, run `npm run release:soundscaper:prepare`
without a version to synchronize those packaging files. Use
`npm run release:soundscaper:prepare -- --check` to check consistency without
writing files. Policy inventories refer to the register; a version bump does
not require policy, checksum, or test-fixture edits.

Commit the register and synchronized packaging files together. For an RC or
beta, push the printed `soundscaper-v<version>` tag to start the desktop preview
workflow. It assembles packages and checksums in its `release-inventory`
artifact; GitHub prerelease publication remains a separate step.

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
This route is independent of the Astro handbook's `/docs` base and loads no
editor JavaScript.

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
downloads use the EXE installer, and Linux downloads use the AppImage. Explicit
links override browser detection and can be shared or bookmarked:

| Package | Stable Soundscaper URL |
| --- | --- |
| Windows x64 installer | `https://soundscaper.org/download/desktop/soundscaper-windows-x64.exe` |
| Windows ARM64 installer | `https://soundscaper.org/download/desktop/soundscaper-windows-arm64.exe` |
| macOS Apple silicon | `https://soundscaper.org/download/desktop/soundscaper-mac-arm64.dmg` |
| Linux x64 AppImage | `https://soundscaper.org/download/desktop/soundscaper-linux-x64.AppImage` |
| Linux ARM64 AppImage | `https://soundscaper.org/download/desktop/soundscaper-linux-arm64.AppImage` |

Windows ZIPs and Linux `.deb` and `.flatpak` packages use the same URLs with the
matching extension. Framescaper uses `framescaper.org` and the `framescaper-`
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
