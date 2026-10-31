/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopDownloadProductId } from './desktop-download-links.ts';

const PACKAGES = [
	['windows-x64.exe', 'win-x64.exe'], ['windows-arm64.exe', 'win-arm64.exe'],
	['windows-x64.zip', 'win-x64.zip'], ['windows-arm64.zip', 'win-arm64.zip'],
	['mac-arm64.dmg', 'mac-arm64.dmg'],
	['linux-x64.AppImage', 'linux-x64.AppImage'], ['linux-arm64.AppImage', 'linux-arm64.AppImage'],
	['linux-x64.deb', 'linux-x64.deb'], ['linux-arm64.deb', 'linux-arm64.deb'],
	['linux-x64.flatpak', 'linux-x64.flatpak'], ['linux-arm64.flatpak', 'linux-arm64.flatpak'],
] as const;

export type DesktopDownloadTarget = typeof PACKAGES[number][1];

export const DESKTOP_DOWNLOAD_TARGETS: readonly DesktopDownloadTarget[] = Object.freeze(PACKAGES.map(([, target]) => target));

export function desktopDownloadTargetForAsset(asset: string, productId: DesktopDownloadProductId): DesktopDownloadTarget | null {
	return PACKAGES.find(([alias]) => asset === `${productId}-${alias}`)?.[1] ?? null;
}

/** Choose only a platform and architecture the request identifies; explicit links always override detection. */
export function desktopDownloadTargetForHeaders(headers: Headers): DesktopDownloadTarget | null {
	const userAgent = headers.get('User-Agent') ?? '';
	if (headers.get('Sec-CH-UA-Mobile') === '?1' || /Android|iPhone|iPad|iPod|Mobile/iu.test(userAgent)) return null;
	const platform = hint(headers, 'Sec-CH-UA-Platform');
	const architecture = hint(headers, 'Sec-CH-UA-Arch');
	const bitness = hint(headers, 'Sec-CH-UA-Bitness');
	// Hints describe native hardware even when a compatibility UA claims x64.
	const arch = architecture
		? (bitness === '64' && architecture === 'arm' ? 'arm64'
			: bitness === '64' && architecture === 'x86' ? 'x64' : null)
		: /arm64|aarch64/iu.test(userAgent) ? 'arm64'
			: /x86_64|amd64|Win64|WOW64|\bx64\b/iu.test(userAgent) ? 'x64' : null;
	if (arch === null) return null;
	if (platform === 'windows' || (!platform && /Windows NT/iu.test(userAgent))) return `win-${arch}.exe`;
	if (platform === 'linux' || (!platform && /\bLinux\b/iu.test(userAgent))) return `linux-${arch}.AppImage`;
	if (arch === 'arm64' && (platform === 'macos' || (!platform && /Macintosh/iu.test(userAgent)))) return 'mac-arm64.dmg';
	return null;
}

function hint(headers: Headers, name: string): string {
	return (headers.get(name) ?? '').replaceAll('"', '').trim().toLowerCase();
}
