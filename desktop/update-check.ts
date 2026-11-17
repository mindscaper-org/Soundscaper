/* SPDX-License-Identifier: AGPL-3.0-only */
import { compareVersions, isPreviewVersion, parseReleaseVersion, versionFromReleaseTag } from '../src/common/release/release-version.ts';

const RELEASES_API = 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_RELEASE_PAGES = 50;
interface GitHubRelease { readonly tag_name: string; readonly draft?: unknown; readonly prerelease?: unknown; readonly assets?: unknown }
interface CheckerOptions {
	readonly currentVersion: string;
	readonly settings: {
		snapshot(): { readonly updatesEnabled: boolean; readonly lastUpdateCheck: string | null };
		recordUpdateCheck(timestamp: number): Promise<unknown>;
	};
	readonly fetchImpl?: (url: string, options: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
	readonly now?: () => number;
	readonly tagPrefix?: string;
}
export type ReleaseCheckResult =
	| { readonly status: 'available'; readonly version: string; readonly prerelease: boolean }
	| { readonly status: 'disabled' | 'throttled' | 'current' | 'offline' }
	| { readonly status: 'error'; readonly message: string };

export class ReleaseChecker {
	readonly #options: CheckerOptions;
	#availableRelease: GitHubRelease | null = null;
	#availableVersion: string | null = null;
	constructor(options: CheckerOptions) { this.#options = options; }
	async check({ manual = false } = {}): Promise<ReleaseCheckResult> {
		this.#availableRelease = null;
		this.#availableVersion = null;
		const { settings, currentVersion, tagPrefix = 'v', fetchImpl = fetch, now = Date.now } = this.#options;
		const snapshot = settings.snapshot();
		if (!snapshot.updatesEnabled && !manual) return Object.freeze({ status: 'disabled' });
		const timestamp = now();
		const lastCheck = Date.parse(snapshot.lastUpdateCheck ?? '');
		const elapsed = timestamp - lastCheck;
		if (!manual && Number.isFinite(lastCheck) && elapsed >= 0 && elapsed < CHECK_INTERVAL_MS) return Object.freeze({ status: 'throttled' });
		try {
			await settings.recordUpdateCheck(timestamp);
			const releases: unknown[] = [];
			const signal = AbortSignal.timeout(10_000);
			for (let page = 1; page <= MAXIMUM_RELEASE_PAGES; page++) {
				const response = await fetchImpl(page === 1 ? RELEASES_API : `${RELEASES_API}&page=${page}`, { headers: {
					Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
				}, signal });
				if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
				const inventory: unknown = await response.json();
				if (!Array.isArray(inventory)) throw new TypeError('Invalid release inventory');
				releases.push(...inventory);
				if (inventory.length < 20) break;
				if (page === MAXIMUM_RELEASE_PAGES) throw new Error('Release inventory exceeds pagination limit');
			}
			const release = selectUpdate(releases, currentVersion, tagPrefix);
			const version = release ? versionFromReleaseTag(release.tag_name, tagPrefix) : null;
			this.#availableRelease = release;
			this.#availableVersion = version?.text ?? null;
			return version ? Object.freeze({ status: 'available', version: version.text,
				prerelease: release?.prerelease === true || isPreviewVersion(version) }) : Object.freeze({ status: 'current' });
		} catch {
			return manual ? Object.freeze({ status: 'error', message: 'Could not check for updates.' }) : Object.freeze({ status: 'offline' });
		}
	}
	get availableRelease(): GitHubRelease | null { return this.#availableRelease; }
	get availableVersion(): string | null { return this.#availableVersion; }
}

export function selectUpdate(releases: unknown, currentVersion: string, tagPrefix = 'v'): GitHubRelease | null {
	const current = parseReleaseVersion(currentVersion);
	if (!current) return null;
	return (Array.isArray(releases) ? releases as unknown[] : [])
		.filter((value): value is GitHubRelease => !!value && typeof value === 'object'
			&& 'tag_name' in value && typeof value.tag_name === 'string' && !('draft' in value && value.draft))
		.map(release => ({ release, version: versionFromReleaseTag(release.tag_name, tagPrefix) }))
		.filter(({ release, version }) => version && (current.kind !== 'calendar' || version.kind !== 'calendar' || current.product === version.product)
			&& (version.kind === 'calendar' || isPreviewVersion(current) || (!release.prerelease && !isPreviewVersion(version)))
			&& compareVersions(version, current) > 0)
		.sort((left, right) => compareVersions(right.version!, left.version!))[0]?.release ?? null;
}
