/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopDownloadProductId } from '../editor/desktop-download-links.ts';
import { DESKTOP_DOWNLOAD_TARGETS, type DesktopDownloadTarget } from '../editor/desktop-download-target.ts';

// GitHub redirects owner/name URLs after a transfer; repository IDs stay fixed.
const RELEASES_API = 'https://api.github.com/repositories/1299822768/releases';
const RELEASES_WEB = 'https://github.com/LeoWattenberg/Soundscaper/releases';
const MAX_PAGES = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const VERSION_CORE = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;
const PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const CANDIDATE_VERSION = String.raw`${VERSION_CORE}-(?:beta|rc)\.${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*`;
const SOUNDSCAPER_RELEASE_TAG = new RegExp(String.raw`^(?:v${VERSION_CORE}|soundscaper-v${CANDIDATE_VERSION})$`, 'u');
const FRAMESCAPER_RELEASE_TAG = new RegExp(String.raw`^framescaper-v(?:${VERSION_CORE}|${CANDIDATE_VERSION})$`, 'u');

interface GitHubRelease {
	readonly tag_name?: unknown;
	readonly published_at?: unknown;
	readonly draft?: unknown;
	readonly assets?: unknown;
}

interface ReleaseCandidate {
	readonly url: string;
	readonly publishedAt: number;
	readonly tag: string;
}

interface CacheableRequestInit extends RequestInit {
	readonly cf: Readonly<{
		cacheEverything: true;
		cacheTtlByStatus: Readonly<Record<string, number>>;
	}>;
}

export interface DesktopReleaseAsset {
	readonly name: string;
	readonly url: string;
}

export interface DesktopReleaseCandidate {
	readonly version: string;
	readonly publishedAt: string;
	readonly url: string;
	readonly installers: readonly (DesktopReleaseAsset & { readonly target: DesktopDownloadTarget })[];
	readonly resources: readonly DesktopReleaseAsset[];
}

/** A download page represents one published RC; never mix packages from different releases. */
export function selectLatestDesktopRc(releases: unknown, productId: DesktopDownloadProductId): DesktopReleaseCandidate | null {
	if (!Array.isArray(releases)) return null;
	const rcTag = new RegExp(String.raw`^${productId}-v${VERSION_CORE}-rc\.${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*$`, 'u');
	let latest: (DesktopReleaseCandidate & { readonly tag: string }) | null = null;
	for (const value of releases as unknown[]) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
		const release = value as GitHubRelease;
		if (release.draft !== false || typeof release.tag_name !== 'string' || !rcTag.test(release.tag_name)
			|| typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))) continue;
		const tag = release.tag_name;
		const releaseUrl = `${RELEASES_WEB}/download/${encodeURIComponent(tag)}`;
		const installers = DESKTOP_DOWNLOAD_TARGETS.flatMap(target => {
			const name = desktopInstallerName(release.assets, productId, tag, target);
			return name === null ? [] : [{ target, name, url: `${releaseUrl}/${encodeURIComponent(name)}` }];
		});
		if (installers.length === 0) continue;
		const publishedAt = new Date(release.published_at).toISOString();
		if (latest !== null && (publishedAt < latest.publishedAt || (publishedAt === latest.publishedAt && tag <= latest.tag))) continue;
		const resources = ['SHA256SUMS', 'sources.zip', 'THIRD_PARTY_LICENSES.md', 'Soundscaper-AGPL-3.0.txt']
			.filter(name => Array.isArray(release.assets) && release.assets.some((asset: unknown) =>
				asset !== null && typeof asset === 'object' && 'name' in asset && asset.name === name
				&& 'state' in asset && asset.state === 'uploaded'))
			.map(name => ({ name, url: `${releaseUrl}/${encodeURIComponent(name)}` }));
		latest = { tag, version: tag.slice(`${productId}-v`.length), publishedAt,
			url: `${RELEASES_WEB}/tag/${encodeURIComponent(tag)}`, installers, resources };
	}
	return latest;
}

export function selectLatestDesktopRelease(
	releases: unknown,
	productId: DesktopDownloadProductId,
	target: DesktopDownloadTarget | null = null,
): string | null {
	if (!Array.isArray(releases)) return null;
	let latest: ReleaseCandidate | null = null;
	for (const value of releases as unknown[]) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
		const release = value as GitHubRelease;
		if (release.draft !== false || typeof release.tag_name !== 'string'
			|| !productReleaseTag(productId, release.tag_name)
			|| typeof release.published_at !== 'string') continue;
		const installer = desktopInstallerName(release.assets, productId, release.tag_name, target);
		if (installer === null) continue;
		const publishedAt = Date.parse(release.published_at);
		if (!Number.isFinite(publishedAt)) continue;
		const candidate = {
			url: target === null ? `${RELEASES_WEB}/tag/${encodeURIComponent(release.tag_name)}`
				: `${RELEASES_WEB}/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(installer)}`,
			publishedAt,
			tag: release.tag_name,
		};
		if (latest === null || candidate.publishedAt > latest.publishedAt
			|| (candidate.publishedAt === latest.publishedAt && candidate.tag > latest.tag)) latest = candidate;
	}
	return latest?.url ?? null;
}

export async function fetchDesktopReleases(fetchImpl: typeof fetch): Promise<unknown[]> {
	const releases: unknown[] = [];
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = `${RELEASES_API}?per_page=100&page=${page}`;
		const options: CacheableRequestInit = {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'Soundscaper-desktop-downloads',
				'X-GitHub-Api-Version': '2026-03-10',
			},
			signal,
			redirect: 'error',
			cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 300, '400-599': 0 } },
		};
		const response = await fetchImpl(url, options);
		if (!response.ok) throw new Error(`GitHub release listing returned HTTP ${response.status}.`);
		if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) {
			throw new Error('GitHub release listing was not JSON.');
		}
		const pageReleases = await readBoundedJson(response);
		if (!Array.isArray(pageReleases)) throw new Error('GitHub release listing was not an array.');
		releases.push(...pageReleases);
		if (!/rel="next"/u.test(response.headers.get('link') ?? '')) return releases;
	}
	throw new Error(`GitHub release listing exceeded ${MAX_PAGES} pages.`);
}

async function readBoundedJson(response: Response): Promise<unknown> {
	const contentLength = Number(response.headers.get('content-length'));
	if (contentLength > MAX_RESPONSE_BYTES) throw new Error('GitHub release listing exceeded its size limit.');
	if (response.body === null) throw new Error('GitHub release listing had no body.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error('GitHub release listing exceeded its size limit.');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function productReleaseTag(productId: DesktopDownloadProductId, tag: string): boolean {
	return productId === 'soundscaper'
		? SOUNDSCAPER_RELEASE_TAG.test(tag)
		: FRAMESCAPER_RELEASE_TAG.test(tag);
}

function desktopInstallerName(
	assets: unknown,
	productId: DesktopDownloadProductId,
	tag: string,
	target: DesktopDownloadTarget | null,
): string | null {
	if (!Array.isArray(assets)) return null;
	const prefix = productId === 'soundscaper' ? 'Soundscaper-' : 'Framescaper-';
	const version = tag.replace(/^(?:soundscaper-|framescaper-)?v/u, '');
	for (const value of assets as unknown[]) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
		const asset = value as Readonly<{ name?: unknown; state?: unknown }>;
		if (asset.state !== 'uploaded' || typeof asset.name !== 'string') continue;
		if (target !== null) {
			if (asset.name === `${prefix}${version}-${target}`) return asset.name;
		} else if (asset.name.startsWith(prefix) && !/source/iu.test(asset.name)
			&& /\.(?:AppImage|deb|dmg|pkg|exe|zip|flatpak)$/iu.test(asset.name)) return asset.name;
	}
	return null;
}
