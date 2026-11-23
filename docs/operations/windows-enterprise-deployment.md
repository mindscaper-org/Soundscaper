# Windows enterprise deployment

Soundscaper and Framescaper publish a signed, per-machine MSI alongside their
NSIS EXE and portable ZIP. MSI installation, repair and removal run without an
interactive user. Installation starts no application and downloads no optional
codecs or models. Each product retains a permanent MSI upgrade code; do not
change those identifiers after publication.

## Install and update

Assign the architecture-specific MSI through **Computer Configuration > Software
Settings > Software installation**, using its full UNC path on a share readable
by the target computers. For a direct unattended installation:

```powershell
msiexec /i "Soundscaper-rc.2026.Nov.11.a-win-x64.msi" /qn /norestart /l*v "$env:TEMP\soundscaper-msi.log"
```

Use Windows Installer or the organization's deployment system to upgrade,
repair or uninstall the application. MSI installations prohibit application
self-updates, including manual checks and installers staged by an earlier EXE
installation. Preferences and projects are preserved on uninstall. Policies are
owned by Group Policy and remain independent of the application installer.

The MSI refuses an existing per-machine NSIS installation. Uninstall that EXE
installation before deploying the MSI; its uninstaller preserves user data.
The EXE also refuses an MSI-owned installation. Keep update deployment within
one installer family.

Both Windows x64 and ARM64 payloads retain the same application resources,
native capabilities and GPU runtime requirements as the other desktop packages.
The pinned electron-builder 26.18.1 uses an x64 MSI container for the ARM64 app;
qualification must include an actual Windows ARM64 machine.

MSI's first two numeric version fields are limited to 255 and its third to
65535. Public calendar names and application package metadata remain unchanged.
The MSI-only version encodes days since 2000-01-01 as two base-256 fields and
retains the existing per-day build/channel revision in the third field. For
example, `Soundscaper-rc.2026.Nov.11.a` becomes `38.83.2`. Unsupported dates or
revision overflow fail packaging. The `msiProjectCreated` hook changes the WiX
product version, not the application's version or update comparison rules.

## Group Policy templates

Copy `soundscaper.admx` and/or `framescaper.admx` into the domain Central Store's
`PolicyDefinitions` directory, and the corresponding `en-US/*.adml` files into
its `en-US` subdirectory. Templates are available under the installed
application's `resources/policies/` directory and in `desktop/policies/` in the
source distribution. Policies appear under the product's **Administrative
Templates** category in both Computer and User Configuration.

The application reads the following 64-bit registry keys at startup:

- `HKLM\Software\Policies\Mindscaper\Soundscaper`
- `HKCU\Software\Policies\Mindscaper\Soundscaper`

Framescaper uses `Framescaper` as the final key component. Machine values take
precedence over user values per setting. Reading uses local registry state and
requires no connection to the domain controller. The startup reader can use
default policy when native 64-bit registry listings confirm the product's
policy and installer keys are absent. Run `gpupdate` to refresh
Windows policy material, then restart the application to apply changes.
Policy applies equally to EXE, MSI and portable launches. No policy means normal
application behavior; invalid policy or a registry-query failure stops startup
instead of silently discarding restrictions.

Feature values are `REG_DWORD`, with `0` prohibiting and `1` allowing the feature.
Allowing a feature preserves existing user consent and opt-in behavior.

| Value | Controls |
| --- | --- |
| `OnlineFeaturesAllowed` | Master permission for internet features below |
| `ApplicationUpdatesAllowed` | Automatic/manual checks, downloads and pending installation; MSI always prohibits self-updates |
| `ModelDownloadsAllowed` | Model and runtime downloads; installed/preseeded local models remain usable |
| `FreesoundAllowed` | Freesound authorization, search, previews, transfers and uploads |
| `AudiocomAllowed` | audio.com authorization, media transfers and project synchronization |
| `WebVcrAllowed` | Framescaper's isolated guest browser |
| `ExternalLinksAllowed` | System-browser links and authorization handoffs |
| `ExternalCodecInstallationAllowed` | In-app FFmpeg installation through a package manager; existing codecs remain usable |
| `LocalIntegrationsAllowed` | MCP server and live Blender connections; independent of the online master |

The master prohibition overrides individual online permissions. These policies
control application-owned feature entry points, not the operating system's
network permissions for independent third-party software. File-based Blender
export, local editing and locally installed inference retain their normal paths.

## Reset selected preferences at launch

`LaunchPreferences` is a `REG_SZ` JSON patch, limited to 65,536 characters:

```json
{
  "schemaVersion": 1,
  "desktop": { "locale": "de", "updatesEnabled": false },
  "editor": {
    "appearance": { "theme": "dark" },
    "saving": { "autoSaving": false },
    "performance": { "optimizeFor": "speed" }
  }
}
```

Unspecified fields retain their saved values. Machine and user patches merge
by field, with machine values taking precedence and arrays replaced as a unit.
Editor values use the existing preference schema and validation. Supported
desktop fields are `locale`, `modelsDirectory`, `updatesEnabled`,
`nativeProbeHelperEnabled`, `nativeAudioHelperEnabled`,
`nativePluginDiscoveryEnabled`, `nativeMediaEnabled`,
`nativeHardwareDecodeEnabled`, `nativeHardwareEncodeEnabled`, and
`ofxConsentEnabled`. Credentials, executable selections, calibration evidence
and project content are not preference-preset inputs.

Presets apply after saved preferences load and before session defaults consume
them. Users may change these preferences during a session. A process launch
identifier prevents renderer reloads from resetting those changes; the next
application launch reapplies the patch. Removing the policy stops resetting
values and leaves the latest saved preferences in place. Feature prohibitions
remain enforced regardless of preference changes. Newer, read-only preference
schemas are preserved rather than overwritten.

Windows Group Policy Preferences refresh on Windows' policy schedule, so merely
copying a settings file does not implement this launch behavior. Keep presets in
the policy key and let application startup apply them.

## Maintenance and qualification

Regenerate templates after changing the policy contract:

```sh
node scripts/generate-windows-policy-templates.mjs
node scripts/generate-windows-policy-templates.mjs --check
```

Package audits open MSI databases read-only, extract embedded cabinets, reconstruct
File/Component/Directory table paths, and verify the existing installed-content
manifest. They do not run an administrative installation or custom actions.
Windows CI additionally runs `scripts/test-windows-msi.ps1` against each packaged
product/architecture to exercise installation, repair, removal, installed
templates and user-data preservation on disposable runners. MSI signing checks
and public checksums cover the new artifacts alongside the EXE.

Before a first enterprise release, qualify successive-version upgrades,
downgrade refusal, EXE-to-MSI migration, domain assignment, machine/user policy
precedence, disconnected startup and both native Windows architectures. Linux
Node and browser tests do not establish Windows Installer or domain behavior.
