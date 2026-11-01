# Desktop installers

Soundscaper and Framescaper share the same installation options. Windows uses
an NSIS setup program and macOS offers a PKG installer alongside the DMG.
The download page prefers the PKG for Apple silicon Macs; explicit DMG links
remain available.

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
projects. User-selected external model directories and other external paths
remain explicit selections. An explicit `--user-data-dir` and diagnostic test
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
Portable script and package-plan tests do not establish that native installers
or online package-manager bootstraps work on a particular user's machine.
