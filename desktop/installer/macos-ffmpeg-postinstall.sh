#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# This script belongs only to the optional FFmpeg component of the product PKG.
set -euo pipefail
export PATH='/usr/bin:/bin:/usr/sbin:/sbin'

PRODUCT_NAME='@PRODUCT_NAME@'
HOMEBREW_INSTALL_REVISION='8c82c081753d4263da0cfe615ef8d9433425f22b'
HOMEBREW_INSTALL_SHA256='5f333bbe53bc490e51e7ccb1df8779b3dd6ee73a1a7379efda216edb08ccb148'
install_user=''
install_home=''
working_directory=''
clt_marker_created=''
homebrew_prefix='/opt/homebrew'

fail() {
	printf 'FFmpeg support: %s\n' "$*" >&2
	return 1
}

cleanup() {
	if [[ -n "$working_directory" ]]; then /bin/rm -rf "$working_directory"; fi
	if [[ -n "$clt_marker_created" ]]; then /bin/rm -f "$clt_marker_created"; fi
}

read_install_user() {
	install_user="$(/usr/bin/stat -f '%Su' /dev/console)"
	case "$install_user" in ''|root|loginwindow|_mbsetupuser|*[!a-zA-Z0-9._-]*) fail 'Log in to a user account before selecting FFmpeg support.'; return 1;; esac
	[[ "$(/usr/bin/id -u "$install_user")" -gt 0 ]] || return 1
	local home_record
	home_record="$(/usr/bin/dscl . -read "/Users/$install_user" NFSHomeDirectory)"
	install_home="${home_record#NFSHomeDirectory: }"
	[[ "$install_home" == /* && "$install_home" != *$'\n'* && -d "$install_home" ]] || {
		fail 'The logged-in user has no available home directory.'; return 1;
	}
}

run_as_user() {
	# No package download, Homebrew command, or marker write runs as root.
	/usr/bin/sudo -H -u "$install_user" /usr/bin/env -i \
		HOME="$install_home" USER="$install_user" LOGNAME="$install_user" SHELL='/bin/bash' \
		PATH="$homebrew_prefix/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
		NONINTERACTIVE=1 HOMEBREW_NO_SUDO=1 HOMEBREW_NO_ANALYTICS=1 \
		HOMEBREW_NO_ENV_HINTS=1 "$@"
}

ensure_command_line_tools() {
	local developer_directory clt_label catalog
	developer_directory="$(/usr/bin/xcode-select --print-path 2>/dev/null || true)"
	if [[ -n "$developer_directory" && -x "$developer_directory/usr/bin/git" ]]; then return; fi
	printf '%s\n' 'FFmpeg support: installing Apple Command Line Tools required by Homebrew.'
	local marker='/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress'
	[[ ! -L "$marker" ]] || { fail 'The Command Line Tools marker is a symbolic link.'; return 1; }
	if [[ ! -e "$marker" ]]; then
		/usr/bin/touch "$marker"
		clt_marker_created="$marker"
	fi
	catalog="$(/usr/sbin/softwareupdate --list)"
	clt_label="$(printf '%s\n' "$catalog" | /usr/bin/awk -F ': ' '/\* Label: Command Line Tools/ { label = $2 } END { print label }')"
	[[ -n "$clt_label" ]] || { fail 'Apple did not offer Command Line Tools for this Mac. See the Installer log.'; return 1; }
	/usr/sbin/softwareupdate --install "$clt_label" --verbose
	/usr/bin/xcode-select --switch /Library/Developer/CommandLineTools
	[[ -x /Library/Developer/CommandLineTools/usr/bin/git ]] || { fail 'Apple Command Line Tools installation did not complete.'; return 1; }
}

ensure_homebrew() {
	if [[ -x "$homebrew_prefix/bin/brew" ]]; then return; fi
	[[ ! -L /opt && ! -L "$homebrew_prefix" ]] || { fail 'The Homebrew installation prefix must not be a symbolic link.'; return 1; }
	ensure_command_line_tools
	# The pinned official installer runs without sudo once a fresh prefix is writable.
	# Never recursively change ownership or permissions of an existing Homebrew tree.
	if [[ ! -e "$homebrew_prefix" ]]; then
		/usr/bin/install -d -o "$install_user" -g "$(/usr/bin/id -gn "$install_user")" -m 0755 "$homebrew_prefix"
	fi
	run_as_user /usr/bin/test -w "$homebrew_prefix" || { fail 'The existing Homebrew prefix is not writable by the logged-in user.'; return 1; }
	working_directory="$(/usr/bin/mktemp -d /private/tmp/scape-homebrew.XXXXXXXX)"
	/bin/chmod 0755 "$working_directory"
	local installer_script="$working_directory/install.sh"
	/usr/bin/curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
		--tlsv1.2 --connect-timeout 30 --max-time 300 \
		"https://raw.githubusercontent.com/Homebrew/install/$HOMEBREW_INSTALL_REVISION/install.sh" \
		--output "$installer_script"
	local downloaded_sha256
	downloaded_sha256="$(/usr/bin/shasum -a 256 "$installer_script")"
	[[ "${downloaded_sha256%% *}" == "$HOMEBREW_INSTALL_SHA256" ]] || { fail 'The Homebrew installer failed its SHA-256 check.'; return 1; }
	/bin/chmod 0644 "$installer_script"
	run_as_user /bin/bash "$installer_script"
	[[ -x "$homebrew_prefix/bin/brew" ]] || { fail 'Homebrew installation did not complete.'; return 1; }
}

install_ffmpeg() {
	ensure_homebrew
	printf '%s\n' 'FFmpeg support: installing FFmpeg through Homebrew.'
	run_as_user "$homebrew_prefix/bin/brew" install ffmpeg
	run_as_user "$homebrew_prefix/bin/ffmpeg" -version >/dev/null
	run_as_user "$homebrew_prefix/bin/ffprobe" -version >/dev/null
	local preferences="$install_home/Library/Application Support/$PRODUCT_NAME"
	run_as_user /bin/mkdir -p "$preferences"
	printf '1\n' | run_as_user /usr/bin/tee "$preferences/ffmpeg-installer-consent" >/dev/null
}

main() {
	[[ "$(/usr/bin/id -u)" == 0 ]] || { fail 'The optional component must run through Installer.'; return 1; }
	[[ "${3:-/}" == / ]] || { fail 'FFmpeg support must be installed on the startup volume.'; return 1; }
	trap cleanup EXIT
	read_install_user
	install_ffmpeg
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
