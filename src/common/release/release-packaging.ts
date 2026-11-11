/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseReleaseVersion } from './release-version.ts';

/** Numeric transport required by package formats; public releases use their calendar names. */
export function calendarPackageVersion(value: string): string {
	const version = parseReleaseVersion(value);
	if (version?.kind !== 'calendar') throw new TypeError('A named calendar release version is required.');
	let build = 0;
	for (const letter of version.build) {
		build = build * 26 + letter.charCodeAt(0) - 96;
		if (build > 16384) throw new RangeError('Calendar build letters exceed the native package build limit (16384 per day).');
	}
	const rank = (build - 1) * 4 + ({ alpha: 0, beta: 1, rc: 2, stable: 3 } as const)[version.channel];
	return `${version.year}.${(version.month + 1) * 100 + version.day}.${rank}`;
}
export function releaseArtifactStem(value: string, productName: string): string {
	const version = parseReleaseVersion(value);
	if (version?.kind === 'calendar') {
		if (version.product !== productName) throw new TypeError('Release artifact product does not match its version.');
		return version.text;
	}
	return `${productName}-${value}`;
}
