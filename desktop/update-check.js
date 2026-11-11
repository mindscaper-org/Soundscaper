const RELEASES_API = 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class ReleaseChecker {
	#currentVersion;
	#fetch;
	#now;
	#settings;
	#tagPrefix;
	#availableRelease = null;
	#availableVersion = null;

	constructor({ currentVersion, settings, fetchImpl = fetch, now = Date.now, tagPrefix = 'v' }) {
		this.#currentVersion = currentVersion;
		this.#settings = settings;
		this.#fetch = fetchImpl;
		this.#now = now;
		this.#tagPrefix = String(tagPrefix || 'v');
	}

	async check({ manual = false } = {}) {
		this.#availableRelease = null;
		this.#availableVersion = null;
		const settings = this.#settings.snapshot();
		if (!settings.updatesEnabled && !manual) return Object.freeze({ status: 'disabled' });
		const now = this.#now();
		const lastCheck = Date.parse(settings.lastUpdateCheck);
		const elapsedSinceLastCheck = now - lastCheck;
		if (!manual && Number.isFinite(lastCheck) && elapsedSinceLastCheck >= 0
			&& elapsedSinceLastCheck < CHECK_INTERVAL_MS) {
			return Object.freeze({ status: 'throttled' });
		}
		try {
			await this.#settings.recordUpdateCheck(now);
			const response = await this.#fetch(RELEASES_API, {
				headers: {
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
			const releases = await response.json();
			const release = selectUpdate(releases, this.#currentVersion, this.#tagPrefix);
			this.#availableRelease = release;
			this.#availableVersion = release ? normalizeVersion(String(release.tag_name).slice(this.#tagPrefix.length)) : null;
			return release
				? Object.freeze({ status: 'available', version: normalizeVersion(String(release.tag_name).slice(this.#tagPrefix.length)), prerelease: release.prerelease === true })
				: Object.freeze({ status: 'current' });
		} catch {
			return manual
				? Object.freeze({ status: 'error', message: 'Could not check for updates.' })
				: Object.freeze({ status: 'offline' });
		}
	}

	get availableRelease() { return this.#availableRelease; }
	get availableVersion() { return this.#availableVersion; }
}

export function selectUpdate(releases, currentVersion, tagPrefix = 'v') {
	const current = parseVersion(currentVersion);
	if (!current) return null;
	const includePrereleases = current.prerelease.length > 0;
	return (Array.isArray(releases) ? releases : [])
		.filter((release) => release && !release.draft && String(release.tag_name || '').startsWith(tagPrefix))
		.map((release) => ({ release, version: parseVersion(String(release.tag_name).slice(tagPrefix.length)) }))
		.filter(({ release, version }) => version && (includePrereleases || (!release.prerelease && version.prerelease.length === 0))
			&& compareVersions(version, current) > 0)
		.sort((left, right) => compareVersions(right.version, left.version))[0]?.release || null;
}

export function compareVersions(leftValue, rightValue) {
	const left = typeof leftValue === 'string' ? parseVersion(leftValue) : leftValue;
	const right = typeof rightValue === 'string' ? parseVersion(rightValue) : rightValue;
	if (!left || !right) throw new TypeError('Invalid semantic version');
	for (const key of ['major', 'minor', 'patch']) {
		if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	}
	if (!left.prerelease.length && !right.prerelease.length) return 0;
	if (!left.prerelease.length) return 1;
	if (!right.prerelease.length) return -1;
	const leftDate = datedReleaseCandidate(left.prerelease);
	const rightDate = datedReleaseCandidate(right.prerelease);
	if (leftDate && rightDate) {
		for (let index = 0; index < leftDate.length; index += 1) {
			if (leftDate[index] !== rightDate[index]) return leftDate[index] < rightDate[index] ? -1 : 1;
		}
		return 0;
	}
	const length = Math.max(left.prerelease.length, right.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left.prerelease[index];
		const rightPart = right.prerelease[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (leftPart === rightPart) continue;
		const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : null;
		const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : null;
		if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1;
		if (leftNumber !== null) return -1;
		if (rightNumber !== null) return 1;
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

function datedReleaseCandidate(parts) {
	if (parts.length !== 4 || parts[0] !== 'rc'
		|| !/^(?:[1-9]|[12]\d|3[01])$/u.test(parts[2]) || !/^[a-z]+$/u.test(parts[3])) return null;
	const month = RC_MONTHS.indexOf(parts[1]);
	if (month < 0) return null;
	// Match release:soundscaper:rc: calendar date, then a..z, aa..zz, aaa...
	return [month, Number(parts[2]), parts[3].length, parts[3]];
}

function parseVersion(value) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(value || '').trim());
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ? match[4].split('.') : [],
	};
}

function normalizeVersion(value) {
	return String(value || '').trim().replace(/^v/u, '');
}
