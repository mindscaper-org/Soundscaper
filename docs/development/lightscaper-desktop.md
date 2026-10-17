# Building the managed Lightscaper desktop package

Use Node.js 26.5.0 and npm 12.0.1 from the repository root. Select the photo
product explicitly; the ordinary desktop packaging commands then select
Lightscaper's dedicated builder configuration and verification hooks:

```sh
SCAPE_PRODUCT=lightscaper npm run desktop:dir
SCAPE_PRODUCT=lightscaper npm run desktop:dist
```

Each command prepares a fresh stage before packaging. Preparation refuses an
existing stage rather than deleting another process's output. Run the commands
separately with fresh directories, or remove the previous stage after its
readers have exited. The default stage is `.desktop-build/` and the default
package output is `release/desktop/`.

For a private Linux x64 verification build, select both the stage and output:

```sh
verification_root="$(mktemp -d -t lightscaper-desktop.XXXXXXXX)"
SCAPE_PRODUCT=lightscaper \
SCAPE_DESKTOP_BUILD_ROOT="$verification_root/stage" \
npm run desktop:dir -- --linux --x64 \
  --config.directories.output="$verification_root/packages"

xvfb-run -a node --import tsx \
  scripts/lightscaper-desktop-managed-smoke-current-v1.ts \
  --executable "$verification_root/packages/linux-unpacked/lightscaper" \
  --runtime-root "$verification_root/packages/linux-unpacked/resources/runtime" \
  --output-root "$verification_root/smoke"
```

The build-root override selects the app, icons, renderer, RAW runtime and
licenses together. Relative overrides resolve from the repository root.
The builder verifies that the selected stage matches its product, version,
target and complete resource inventory before packaging, then authenticates
the packaged resources, alternate Electron media library and production fuses.
The override applies to `desktop:dir` and `desktop:dist`; the existing
`desktop:dev` launcher uses the default stage.

To produce Linux installers, use `desktop:dist` with a fresh stage and the
same output override. Its default Linux targets are AppImage and Debian.
Artifact names use `Lightscaper`, the photo release version and `x64` or
`arm64`. Producing or extracting an installer does not establish that system
installation, desktop integration or upgrades have been exercised.

The managed smoke imports raster and RAW Originals, saves Develop state,
authenticates exported pixels and backup bytes, and verifies persistence,
explicit restore confirmation and reopening in three fresh native processes.
It uses a private profile and requires normal Electron sandboxing. Windows
qualification still requires native process-retirement support. The admitted
packaging targets are Linux x64/arm64, macOS arm64 and Windows x64/arm64;
platform admission alone does not establish a successful native qualification.

After packaging and all smoke readers exit, remove the private verification
directory. Keep the small qualification receipts if needed. The complete L8
requirements remain in the [roadmap](../../roadmap-lightscaper.md#l8-desktop-tier),
including native libraries, add-in-place access and the release/nightly matrix.
