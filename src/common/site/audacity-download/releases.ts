/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopDownloadEnvironmentForHeaders } from '../../editor/desktop-download-target.ts';
import { fetchDesktopReleases, selectLatestDesktopRc } from '../desktop-releases.ts';
import fallback from './releases.json' with { type: 'json' };

export const AUDACITY_RELEASES_URL = 'https://raw.githubusercontent.com/audacity/audacity.github.io/refs/heads/main/src/assets/data/audacityReleases.ts';
export interface DownloadAsset {
	readonly name: string;
	readonly url: string;
	readonly platform: string;
	readonly architecture: string;
	readonly format: string;
	readonly variant?: string;
}
export interface DownloadRelease { readonly version: string; readonly url: string; readonly assets: readonly DownloadAsset[] }
export type DownloadReleases = Readonly<Record<'soundscaper' | 'audacity4' | 'audacity3', DownloadRelease>>;

/** Parse the upstream literal as data; never evaluate remote TypeScript. */
export function parseAudacityRelease(source: string): DownloadRelease {
	const literal = source.match(/export\s+const\s+audacityReleases(?:\s*:\s*\w+)?\s*=\s*\{([\s\S]*?)^\s*\};/mu)?.[1]
		?? source.match(/export\s+const\s+audacityReleases\s*=\s*\{([\s\S]*)\};/u)?.[1];
	const version = literal?.match(/\bversion:\s*["'](4\.\d+\.\d+)["']/u)?.[1];
	if (!literal || !version) throw new Error('Audacity 4 release data is unavailable.');
	const assets: DownloadAsset[] = [];
	for (const [, os, entries] of literal.matchAll(/\b(win|mac|lin):\s*\[([\s\S]*?)\]/gu)) {
		for (const [entry] of entries.matchAll(/\{[^{}]*\}/gu)) {
			const name = entry.match(/\bname:\s*["']([^"']+)["']/u)?.[1];
			const address = entry.match(/\bbrowser_download_url:\s*["']([^"']+)["']/u)?.[1];
			if (!name || !address) continue;
			let url: URL;
			try { url = new URL(address); } catch { continue; }
			const filename = url.pathname.split('/').pop() ?? '';
			if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
				|| !url.pathname.startsWith(`/audacity/audacity/releases/download/Audacity-${version}/`)
				|| /source|manual|corresponding/iu.test(filename)) continue;
			const format = filename.match(/\.(msi|exe|dmg|pkg|AppImage|deb|zip|7z)$/iu)?.[1];
			const architecture = /arm64|aarch64/iu.test(filename) ? 'arm64' : /universal/iu.test(filename) ? 'universal'
				: /x86_64|amd64|x64|64bit/iu.test(filename) ? 'x64' : null;
			if (format && architecture) assets.push({ name, url: url.href, platform: os === 'lin' ? 'linux' : os, architecture, format });
		}
	}
	if (!assets.length) throw new Error('Audacity 4 has no desktop downloads.');
	return { version, url: `https://github.com/audacity/audacity/releases/tag/Audacity-${version}`, assets };
}

export async function currentDownloadReleases(fetchImpl: typeof fetch): Promise<DownloadReleases> {
	const [soundscaper, audacity4] = await Promise.allSettled([
		fetchDesktopReleases(fetchImpl).then(releases => {
			const release = selectLatestDesktopRc(releases, 'soundscaper');
			if (!release) throw new Error('No Soundscaper release candidate.');
			return { ...release, assets: release.installers.map(asset => {
				const [platform, architecture, format] = asset.target.split(/[-.]/u);
				return { ...asset, platform, architecture, format };
			}) };
		}),
		fetchAudacityRelease(fetchImpl),
	]);
	for (const [product, result] of [['soundscaper', soundscaper], ['audacity4', audacity4]] as const) {
		if (result.status === 'rejected') console.warn(JSON.stringify({ event: 'audacity_download_fallback', product,
			reason: result.reason instanceof Error ? result.reason.message : String(result.reason) }));
	}
	return { soundscaper: soundscaper.status === 'fulfilled' ? soundscaper.value : fallback.soundscaper,
		audacity4: audacity4.status === 'fulfilled' ? audacity4.value : fallback.audacity4, audacity3: fallback.audacity3 };
}

async function fetchAudacityRelease(fetchImpl: typeof fetch): Promise<DownloadRelease> {
	const response = await fetchImpl(AUDACITY_RELEASES_URL, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
	if (!response.ok || !response.body) throw new Error(`Audacity release lookup returned ${response.status}.`);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let source = '', bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 256 * 1024) throw new Error('Audacity release data exceeded its size limit.');
			source += decoder.decode(value, { stream: true });
		}
	} catch (error) { await reader.cancel().catch(() => undefined); throw error; }
	finally { reader.releaseLock(); }
	return parseAudacityRelease(source + decoder.decode());
}

export function matchingDownload(assets: readonly DownloadAsset[], headers: Headers): DownloadAsset | undefined {
	const environment = desktopDownloadEnvironmentForHeaders(headers);
	const isX86 = /x86/u.test(headers.get('Sec-CH-UA-Arch') ?? '') && headers.get('Sec-CH-UA-Bitness')?.includes('32');
	const architecture = isX86 ? 'x86' : environment.architecture;
	const priority: Readonly<Record<string, number>> = { exe: 0, msi: 0, pkg: 0, dmg: 1, appimage: 0, deb: 1, flatpak: 2, zip: 3, '7z': 3 };
	return assets.filter(asset => asset.platform === environment.platform
		&& (asset.architecture === architecture || asset.architecture === 'universal'))
		.sort((a, b) => (priority[a.format.toLowerCase()] ?? 9) - (priority[b.format.toLowerCase()] ?? 9)
			|| Number(a.architecture === 'universal') - Number(b.architecture === 'universal')
			|| (a.variant ?? '').localeCompare(b.variant ?? ''))[0];
}

export function assetLabel(asset: DownloadAsset, copy: Readonly<{ universal: string; bits32: string }>): string {
	const platform = { win: 'Windows', mac: 'macOS', linux: 'Linux' }[asset.platform] ?? asset.platform;
	const architecture = { x64: 'x64 / Intel', arm64: 'ARM64', x86: copy.bits32, universal: copy.universal }[asset.architecture] ?? asset.architecture;
	return `${platform} · ${architecture} · ${asset.format}${asset.variant ? ` (Ubuntu ${asset.variant}+)` : ''}`;
}
