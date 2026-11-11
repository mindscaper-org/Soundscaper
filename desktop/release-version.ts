/* SPDX-License-Identifier: AGPL-3.0-only */
const MONTHS: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHANNELS = { alpha: 0, beta: 1, rc: 2, stable: 3 } as const;
interface CalendarVersion {
	readonly kind: 'calendar'; readonly text: string; readonly product: 'Soundscaper' | 'Framescaper';
	readonly year: number; readonly month: number; readonly day: number; readonly build: string;
	readonly channel: keyof typeof CHANNELS;
}
interface SemanticVersion {
	readonly kind: 'semantic'; readonly text: string;
	readonly major: number; readonly minor: number; readonly patch: number; readonly prerelease: readonly string[];
}
export type ReleaseVersion = CalendarVersion | SemanticVersion;

export function parseReleaseVersion(value: unknown): ReleaseVersion | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	const calendar = /^(Soundscaper|Framescaper)(?:-(alpha|beta|rc))?\.([1-9]\d{3})\.([A-Z][a-z]{2})\.([1-9]|[12]\d|3[01])\.([a-z]+)$/u.exec(text);
	if (calendar) {
		const year = Number(calendar[3]), month = MONTHS.indexOf(calendar[4]!), day = Number(calendar[5]);
		if (month < 0 || new Date(Date.UTC(year, month, day)).getUTCDate() !== day) return null;
		return { kind: 'calendar', text, product: calendar[1] as CalendarVersion['product'], year, month, day,
			build: calendar[6]!, channel: (calendar[2] ?? 'stable') as CalendarVersion['channel'] };
	}
	const semantic = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(text);
	if (!semantic) return null;
	const major = Number(semantic[1]), minor = Number(semantic[2]), patch = Number(semantic[3]);
	if (![major, minor, patch].every(Number.isSafeInteger)) return null;
	return { kind: 'semantic', text: text.replace(/^v/u, ''), major, minor, patch,
		prerelease: semantic[4] ? semantic[4].split('.') : [] };
}

export function versionFromReleaseTag(tag: string, tagPrefix: string): ReleaseVersion | null {
	const named = parseReleaseVersion(tag);
	if (named?.kind === 'calendar') {
		const product = tagPrefix === 'framescaper-v' ? 'Framescaper'
			: tagPrefix === 'soundscaper-v' || tagPrefix === 'v' ? 'Soundscaper' : null;
		return named.product === product ? named : null;
	}
	if (!tag.startsWith(tagPrefix)) return null;
	const version = parseReleaseVersion(tag.slice(tagPrefix.length));
	return version?.kind === 'semantic' ? version : null;
}

export function releaseTagForVersion(value: string, tagPrefix: string): string {
	const version = parseReleaseVersion(value);
	if (!version) throw new TypeError('Invalid release version.');
	return version.kind === 'calendar' ? version.text : `${tagPrefix}${version.text}`;
}

export function isPreviewVersion(version: ReleaseVersion): boolean {
	return version.kind === 'calendar' ? version.channel !== 'stable' : version.prerelease.length > 0;
}

export function compareVersions(leftValue: string | ReleaseVersion, rightValue: string | ReleaseVersion): number {
	const left = typeof leftValue === 'string' ? parseReleaseVersion(leftValue) : leftValue;
	const right = typeof rightValue === 'string' ? parseReleaseVersion(rightValue) : rightValue;
	if (!left || !right) throw new TypeError('Invalid release version.');
	// Named calendar releases succeed the legacy semantic release line.
	if (left.kind !== right.kind) return left.kind === 'calendar' ? 1 : -1;
	if (left.kind === 'calendar' && right.kind === 'calendar') {
		if (left.product !== right.product) throw new TypeError('Cannot compare versions of different products.');
		for (const key of ['year', 'month', 'day'] as const) {
			if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
		}
		const build = compareBuildLetters(left.build, right.build);
		return build || Math.sign(CHANNELS[left.channel] - CHANNELS[right.channel]);
	}
	if (left.kind !== 'semantic' || right.kind !== 'semantic') throw new TypeError('Invalid release version.');
	for (const key of ['major', 'minor', 'patch'] as const) {
		if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	}
	if (!left.prerelease.length && !right.prerelease.length) return 0;
	if (!left.prerelease.length) return 1;
	if (!right.prerelease.length) return -1;
	const leftDate = datedReleaseCandidate(left.prerelease), rightDate = datedReleaseCandidate(right.prerelease);
	if (leftDate && rightDate) {
		if (leftDate.month !== rightDate.month) return Math.sign(leftDate.month - rightDate.month);
		if (leftDate.day !== rightDate.day) return Math.sign(leftDate.day - rightDate.day);
		return compareBuildLetters(leftDate.build, rightDate.build);
	}
	for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
		const leftPart = left.prerelease[index], rightPart = right.prerelease[index];
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

function compareBuildLetters(left: string, right: string): number {
	if (left.length !== right.length) return Math.sign(left.length - right.length);
	return left === right ? 0 : left < right ? -1 : 1;
}
function datedReleaseCandidate(parts: readonly string[]) {
	if (parts.length !== 4 || parts[0] !== 'rc' || !/^(?:[1-9]|[12]\d|3[01])$/u.test(parts[2]!) || !/^[a-z]+$/u.test(parts[3]!)) return null;
	const month = MONTHS.indexOf(parts[1]!);
	return month < 0 ? null : { month, day: Number(parts[2]), build: parts[3]! };
}
