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

When `LIGHTSCAPER_PHOTO_NATIVE_BUILD_RESULT` is absent, preparation produces the
complete Web Core package with its pinned WASM runtime and no optional Photo
native manifest or helpers. To include native filesystem/RAW services, supply
the absolute `result` directory from the same target and exact source revision
of the authenticated Photo native producer. Preparation and final package hooks
verify its source, roles, enforcement profiles, source/licenses and runtime
bytes; an invalid supplied result does not silently become Web-only.

The native File-menu workflow now owns trusted folder choice, bounded lossless
scans, add-in-place import, serial opt-in checks of the displayed Original page,
exact-byte relink after an external rename/move, and full-workspace retirement
before revocation. Disconnected sources can use authenticated cached previews
in Develop; Original/full-resolution output refuses until genuine regrant/relink.
This bounded watch is not a recursive automatic import service. A separate
linked qualification invocation requires the authenticated native package:

```sh
xvfb-run -a node --import tsx \
  scripts/lightscaper-desktop-managed-smoke-current-v1.ts \
  --scenario linked --backend native \
  --executable "$verification_root/packages/linux-unpacked/lightscaper" \
  --runtime-root "$verification_root/packages/linux-unpacked/resources/runtime" \
  --output-root "$verification_root/linked-smoke"
```

This scenario drives the actual File menu and three fresh processes through
in-place raster/RAW import, disconnected preview and full-output refusal, exact
relink, native RAW Develop, PNG/backup verification and reopen. Real Main plane
hash/wipe and child/stdio retirement observations accompany the renderer report.
The implementation exists; actual successful execution must still be recorded
for each considered package and target. No source definition certifies a run.

The managed smoke imports raster and RAW Originals, saves Develop state,
authenticates exported pixels and backup bytes, and verifies persistence,
explicit restore confirmation and reopening in three fresh native processes.
It uses a private profile and requires normal Electron sandboxing. The admitted
packaging targets are Linux x64/arm64, macOS arm64 and Windows x64/arm64;
platform admission alone does not establish a successful native qualification.

## Windows process retirement

Windows qualification uses a separately built, test-only Job Object supervisor.
From a native MSVC developer shell with CMake and Ninja, build the helper and
its real reader fixtures outside the application stage:

```powershell
$verificationRoot = Join-Path ([IO.Path]::GetTempPath()) ('lightscaper-desktop-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($verificationRoot)
cmake -S native/lightscaper-desktop-managed-smoke-job-current-v1 `
  -B "$verificationRoot/job" -G Ninja -DCMAKE_BUILD_TYPE=Release `
  -DLIGHTSCAPER_SMOKE_NATIVE_TARGET=win-x64
cmake --build "$verificationRoot/job" --parallel 2
cmake -S tests/fixtures/lightscaper-desktop-windows-job-current-v1 `
  -B "$verificationRoot/canary" -G Ninja -DCMAKE_BUILD_TYPE=Release `
  -DLIGHTSCAPER_SMOKE_NATIVE_TARGET=win-x64
cmake --build "$verificationRoot/canary" --parallel 2
```

On a native ARM64 host select `win-arm64` for both builds and `--arm64` for
packaging. The helper and application PE architectures must
match the Node process running qualification. The helper is not an application
runtime asset and is never placed in the packaged resources.

```powershell
$env:SCAPE_PRODUCT = 'lightscaper'
$env:SCAPE_DESKTOP_BUILD_ROOT = Join-Path $verificationRoot 'stage'
npm run desktop:dir -- --win --x64 "--config.directories.output=$verificationRoot/packages"

$env:LIGHTSCAPER_WINDOWS_JOB_NATIVE_REQUIRED = '1'
$env:LIGHTSCAPER_WINDOWS_JOB_HELPER = Join-Path $verificationRoot 'job\lightscaper-desktop-managed-smoke-job-current-v1.exe'
$env:LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256 = (Get-FileHash $env:LIGHTSCAPER_WINDOWS_JOB_HELPER -Algorithm SHA256).Hash.ToLowerInvariant()
$env:LIGHTSCAPER_WINDOWS_JOB_CANARY = Join-Path $verificationRoot 'canary\lightscaper-windows-job-canary-current-v1.exe'
$env:LIGHTSCAPER_WINDOWS_JOB_READER_FIXTURE = Join-Path $verificationRoot 'canary\lightscaper-windows-job-reader-fixture-current-v1.exe'
node --import tsx --test tests/lightscaper-desktop-windows-job-native-current.test.ts

node --import tsx scripts/lightscaper-desktop-managed-smoke-current-v1.ts `
  --executable "$verificationRoot/packages/win-unpacked/Lightscaper.exe" `
  --runtime-root "$verificationRoot/packages/win-unpacked/resources/runtime" `
  --output-root "$verificationRoot/smoke" `
  --windows-job-helper $env:LIGHTSCAPER_WINDOWS_JOB_HELPER `
  --windows-job-helper-sha256 $env:LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256
```

The helper assigns its private Job atomically during suspended process creation
and verifies membership before resuming the app. It permits real sandboxed
Electron descendants and observes the entire Job becoming empty. A nonce- and
stage-bound terminal receipt supplies the app PID and exit code independently
of the supervisor. Missing or invalid terminal evidence retains the profile;
forced termination fails product qualification even when retirement succeeds.

The native tests exercise literal Windows argv and real root/child/grandchild
readers, including nonzero exit, closed standard streams, timeout, quota refusal
before the app runs, and supervisor death. An independent outer Job observes
retirement before exclusive file reopening and deletion. The actual Windows
x64 package has passed the three-process managed workflow with sandboxing
enabled. ARM64 still requires its own target-native run.

The `Lightscaper Windows managed qualification` workflow can be dispatched or
called by another workflow. It independently requires native x64 and ARM64
hosts, all reader cases, public packaging and the managed workflow. It keeps
small receipts and removes its large work directory after proved retirement.
The separate bootstrap compiler build is retained until runner teardown; its
readers are outside the later Jobs' proof. Adding the workflow does not establish
an ARM64 qualification before that target has actually passed.

## Internal all-target Photo qualification

The reusable `Lightscaper internal native desktop qualification` workflow calls
the same-revision all-five Photo producer, then uses public `desktop:dir` on
Linux x64/ARM64, macOS ARM64 and Windows x64/ARM64. It builds two fresh packages
per target. The native package must contain the exact authenticated Photo result
and runs `--scenario linked --backend native`; the independent fallback package
omits that result, must retain only the exact Web runtime, and runs
`--scenario managed --backend web`. The linked scenario must prove actual menu import
in place, relink, Develop, export, reopen and Main-observed native RAW retirement.
The scenario implementation is present, with actual full-process retirement
before profile/source cleanup. Each target's real execution remains qualification
work; a workflow definition or compiler result alone is not a passed packaged
scenario.

Preview/nightly use a separate internal Photo job. Existing Soundscaper and
Framescaper release/M5 jobs and product counts are unchanged. The Photo workflow
uploads bounded receipts, never publishes a release, and requires real process
group or Windows Job retirement before deleting its private work. It passes no
no-sandbox override. A missing retirement receipt retains work for diagnosis or
hosted-runner teardown. Each maintained target requires its own actual run;
existing Linux/Windows observations must not be generalized to the full matrix.

After packaging and all smoke readers exit, remove the private verification
directory. Keep small qualification receipts if needed. The complete L8
requirements remain in the [roadmap](../../roadmap-lightscaper.md#l8-desktop-tier),
including final linked management/watch/relink and packaged-scenario qualification.
The implemented bounded workflows do not establish successful all-five target
runs. Lightscaper's public release channel stays deferred. None of these instructions
requires a manual **Update AI assets** run; Photo native source/inventory changes
require their separate authenticated artifact rebuild.
