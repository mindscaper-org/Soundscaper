# Microsoft Store AppX packaging

The optional AppX build packages the ordinary Soundscaper or Framescaper desktop
application for Microsoft Store submission. Existing NSIS/ZIP distribution keeps
its configuration. AppX output is unsigned: Microsoft signs an accepted Store
submission, while local sideload testing requires a separately signed package.
No command here submits or publishes an application.

## Build on Windows

Use the pinned Node/npm versions from [contribution setup](../../CONTRIBUTING.md),
Git Bash on PATH, and the same native-build inputs required by
`npm run desktop:prepare`. The existing [local-model runtime build
instructions](local-models/build-runtimes.md) apply to Windows x64 and ARM64;
AppX must not omit GPU providers or bypass payload provenance checks.

For a first development package, run from a Windows checkout:

```sh
npm ci
npm run desktop:appx -- --development --arch=x64
# On a Windows ARM64 build host:
npm run desktop:appx -- --development --arch=arm64
```

`--development` selects `Soundscaper.Development` (or
`Framescaper.Development`), publisher `CN=Soundscaper Development` (or
`CN=Framescaper Development`), and package version `1.0.0.0`. This identity is
for local testing. It does not claim a reserved Store name. Omit `--development`
for a real Store identity. `SCAPE_PRODUCT=framescaper` selects Framescaper;
an absent product defaults to Soundscaper and unknown products fail.

`--prepared` reuses an existing `.desktop-build/` prepared for that exact
product/architecture. The ordinary before-pack and after-pack checks still run.
The command scopes signing settings to its child processes, disables native
re-signing, renders the product's existing vector artwork into AppX logos, and
uses the pinned electron-builder manifest template with an explicit package
version. Application version metadata and release registers are unchanged.

Outputs under ignored `release/appx/` are the `.appx`, its `.appx.audit.json`
receipt, and the exact `runtime-manifest-<product>-win-<arch>.json`. The artifact
hook re-extracts the AppX and verifies its installed executable architecture and
authenticated resource/native/runtime closure. These checks do not establish
successful installation, hardware operation, or Store certification.

## Store identity and versions

Reserve the product in Partner Center, then copy its package identity fields
exactly. Set these environment variables before running `npm run desktop:appx`:

| Variable | Value |
| --- | --- |
| `SCAPE_APPX_IDENTITY_NAME` | Partner Center Package/Identity/Name |
| `SCAPE_APPX_PUBLISHER` | Partner Center Package/Identity/Publisher, including `CN=` |
| `SCAPE_APPX_PUBLISHER_DISPLAY_NAME` | Publisher display name |
| `SCAPE_APPX_VERSION` | Explicit increasing numeric package version, such as `1.0.27.0` |

Package versions contain four integers from 0 to 65535, the first must be
nonzero, and the fourth remains zero for Store use. Assign a new package version
for each candidate/update. The ordinary dated RC version is retained inside the
application; it cannot distinguish AppX updates automatically. Keep the Store
version sequence ahead of previously distributed packages, including when a
candidate becomes stable.

The package declares the desktop `runFullTrust` capability and registers the
ordinary project file associations. It does not add startup tasks. Packaged
Windows supplies its application identity; startup does not overwrite it with
the NSIS application ID. Automatic GitHub update checks are skipped, and the
existing manual update action opens Microsoft Store's downloads/updates page.
NSIS's optional FFmpeg setup page is absent; the existing Preferences workflow
remains the explicit installation route.

## Optional CI artifacts

In **Desktop preview and nightly → Run workflow**, choose `appx=development`
for local-test identities or `appx=store` for reserved Store identities. The
default `none` leaves ordinary jobs unchanged. The existing Windows x64 and
ARM64 package jobs reuse their authenticated preparation, build the extra AppX,
and upload separate `appx-<product>-win-<arch>` artifacts. Scheduled and tag runs
do not enable this mode. The workflow still runs its existing quality gates.

For `store`, configure repository variables `SOUNDSCAPER_APPX_IDENTITY_NAME`,
`SOUNDSCAPER_APPX_VERSION`, `FRAMESCAPER_APPX_IDENTITY_NAME`,
`FRAMESCAPER_APPX_VERSION`, `WINDOWS_STORE_PUBLISHER`, and
`WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` for the products being built. These are
package identity values, not signing secrets. Missing values fail the build;
one product never borrows another product's identity or version.

## Windows qualification and submission

For local installation, sign only the finished development AppX with a
code-signing certificate whose subject exactly matches the manifest publisher,
then trust its certificate on the test machine and use `Add-AppxPackage`.
Microsoft documents [development certificate creation](https://learn.microsoft.com/en-us/windows/msix/package/create-certificate-package-signing)
and [package signing](https://learn.microsoft.com/en-us/windows/msix/package/sign-app-package-using-signtool).
Do not modify or re-sign native files inside the package: their hashes are part
of the runtime authentication contract. Outer package signing preserves them.

Test on Windows x64 and ARM64 with real GPU drivers: install/launch, project
file activation, recording, import/export, native plug-ins, optional FFmpeg,
model download and GPU inference, manual Store update navigation, restart,
upgrade, and uninstall. Check profile migration/isolation and data retention
with a test account; NSIS-to-Store profile migration has not been implemented.
Run the Windows App Certification Kit against the package.

Before public submission, complete the listing, screenshots, age rating,
privacy and optional-download disclosures, applicable AGPL terms, corresponding
source links, and third-party notices. Explain `runFullTrust`, native helpers,
and optional model runtimes in certification notes. Review the current
generative-AI disclosure/reporting requirements for Qwen features. This build
path does not establish those policy requirements or Store acceptance.

References: [electron-builder 26 AppX](https://www.electron.build/v26/docs/appx/),
[Microsoft package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements),
[Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).
