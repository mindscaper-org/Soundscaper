# Desktop installers

Soundscaper and Framescaper share the same installation options. Windows uses
an NSIS setup program and macOS offers a PKG installer alongside the DMG.
The download page prefers the PKG for Apple silicon Macs; explicit DMG links
remain available.

## Update checks

General preferences includes **Check for updates**, enabled by default. Automatic
checks run at most once every 24 hours; Help's manual check remains available
when the preference is off. The update notification offers **Install now** and
**Install on next launch**. Closing it or choosing **Skip** skips that update
check without scheduling an installation.

The checker also accepts named calendar release tags such as
`Soundscaper.2026.Nov.11.a` and `Soundscaper-rc.2026.Nov.11.a` (and the equivalent
Framescaper names). Comparison orders year, calendar month, numeric day, and
build letters (`a` through `z`, then `aa`, `ab`, and so on). For an identical
date and build, stable outranks `rc`, then `beta`, then `alpha`. A preview with a
newer date or build is offered to a stable installation. Named calendar releases
succeed the legacy semantic release line; legacy semantic versions retain their
existing stable/preview filtering. Product identity and draft exclusion apply
to both formats. Release creation and packaging still use the semantic versions
in the release register.

Accepting either installation option downloads the exact product, version and
architecture's installer from its GitHub release and verifies its size and
SHA-256 digest. **Install now** opens it immediately; **Install on next launch**
stores it locally and verifies it again before opening it at the next startup.
Windows uses the EXE, macOS the PKG, and Linux the Debian package, retaining
system installation prompts. AppImage launches replace their current AppImage
atomically and restart through the normal project-close flow. Microsoft Store
builds continue to use Store updates.

## Portable settings

Before launching, create a folder named exactly `Portable Settings` in the same
directory as the executable. Startup uses that existing folder as the Electron
user-data directory, including desktop settings, browser storage, project
libraries, default local models and runtimes, application caches, logs, and crash data.
The folder must be writable. An absent folder or a regular file with that name
leaves the normal per-user storage layout in effect; startup never creates the
folder automatically.

For an AppImage, put the folder beside the `.AppImage` file. Windows
self-extracting portable builds look beside the outer `.exe`, rather than in
the temporary extraction directory. On macOS, the executable is inside
`Soundscaper.app/Contents/MacOS/` or `Framescaper.app/Contents/MacOS/`.

Portable startup does not import or move the installed profile's settings or
projects. Portable profiles skip automatic and manual update checks and pending
installations; their update preference is disabled. User-selected external model
directories and other external paths remain explicit selections. An explicit
`--user-data-dir` and diagnostic test
launches take precedence over automatic portable-folder detection.
System components can still maintain shared font and GPU-driver caches and
certificate databases in their normal operating-system locations.

## Optional FFmpeg support

The Windows setup and macOS PKG show this unchecked option:

> Add FFmpeg-support for proprietary file formats (M4A, MP4, MOV and more)

Leaving it unchecked installs only the application. Selecting it authorizes
the package-manager setup described by the installer and the subsequent FFmpeg
installation. Downloads require network access. FFmpeg and its package manager
are installed separately from the application and are not removed when the
application is uninstalled.

On Windows, setup runs the helper as the interactive desktop user, even when
the application installation is elevated. It installs WinGet when missing,
then installs `BtbN.FFmpeg.GPL.8.1` for the target architecture and current user.
The installer disclosure covers accepting the package and source agreements.
The in-app Install action retains its separate confirmation and agreement rules.

On macOS, the PKG contains a required application component and an optional
FFmpeg component. Package scripts run with installation privileges, but
Homebrew and FFmpeg run under the logged-in user's account. When necessary,
setup prepares Homebrew and Apple's Command Line Tools before running
`brew install ffmpeg`. A package-manager or codec installation failure is
reported rather than treated as successful FFmpeg setup.

After successful setup, the helper writes `ffmpeg-installer-consent` containing
`1` followed by a newline in the product's normal Electron user-data directory.
First launch consumes this one-time marker and discovers and probes the
`ffmpeg`/`ffprobe` pair. Later launches reprobe the saved selection. Preferences
still provides Browse, Clear, Rescan, and Install; clearing the selection does
not reuse the installer consent. Those in-app Install actions require an
existing WinGet or Homebrew installation.

## Linux

The Debian package declares `Recommends: ffmpeg` without adding it to `Depends`.
APT normally installs recommended packages; users can omit them with
`--no-install-recommends`. The AppImage does not install system dependencies.
Linux startup discovers and probes existing system FFmpeg.

## Release validation

The macOS PKG contains the same sealed application as the DMG. Package auditing
extracts its payload without executing installation scripts. Signed macOS
releases also require a Developer ID Installer certificate, package
notarization, stapling, and Gatekeeper checks; see [signing](signing.md).
Linux re-auditing accepts metadata without Unix modes generated by `productbuild`
only after verifying that it extracts as regular files. It normalizes bounded
AppleDouble code-signing attributes paired with regular application files;
resource forks, unrelated attributes, orphaned metadata, and symbolic links
are rejected as signing metadata. The original PKG retains its signing attributes.
Portable script and package-plan tests do not establish that native installers
or online package-manager bootstraps work on a particular user's machine.
