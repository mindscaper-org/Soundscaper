/* SPDX-License-Identifier: AGPL-3.0-only */

export interface RawV8Entry { url?: unknown; functions?: unknown }
export interface RawV8Profile {
	result?: RawV8Entry[];
	'source-map-cache'?: Record<string, unknown>;
	[key: string]: unknown;
}
interface SurfaceScript { surface: string; coverageUrl: string }

/** Shared by the legacy Array API and the materializer's one-profile reader. */
export function createRawV8SurfaceValidation(surface: string, scripts: readonly SurfaceScript[]) {
	const expected = new Set(scripts.filter(script => script.surface === surface).map(script => script.coverageUrl));
	const observed = new Set<string>();
	const failures: string[] = [];
	let count = 0;
	return {
		observe(profile: RawV8Profile | null | undefined) {
			count++;
			if (!profile || !Array.isArray(profile.result)) {
				failures.push(`${surface} raw V8 profile ${count} has no result array.`);
				return;
			}
			for (const entry of profile.result) {
				if (typeof entry?.url !== 'string' || entry.url === '') {
					failures.push(`${surface} raw V8 profile ${count} has an entry without a URL.`);
					continue;
				}
				observed.add(entry.url);
			}
		},
		finish() {
			if (count === 0) return [`${surface} supplied no raw V8 coverage profiles.`];
			const result = [...failures];
			if (![...observed].some(url => expected.has(url))) result.push(`${surface} supplied no admitted executable coverage entries.`);
			for (const url of observed) {
				if (!expected.has(url)) result.push(`${surface} reported un-inventoried executable script ${url}.`);
			}
			return result;
		},
	};
}

/** Keep original per-entry and map observation order within one equivalence group. */
export function collectV8ProfileObservations(profiles: readonly RawV8Profile[]) {
	const entriesByUrl = new Map<string, RawV8Entry[]>();
	const sourceMapsByUrl = new Map<string, unknown[]>();
	for (const profile of profiles) {
		for (const entry of profile?.result ?? []) {
			if (typeof entry?.url !== 'string') continue;
			const entries = entriesByUrl.get(entry.url) ?? [];
			entries.push(entry); entriesByUrl.set(entry.url, entries);
		}
		for (const [url, cache] of Object.entries(profile?.['source-map-cache'] ?? {})) {
			const values = sourceMapsByUrl.get(url) ?? [];
			values.push(cache); sourceMapsByUrl.set(url, values);
		}
	}
	return { entriesByUrl, sourceMapsByUrl };
}
