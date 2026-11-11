/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarPackageVersion, releaseArtifactStem } from '../src/common/release/release-packaging.ts';

test('numeric package versions follow the date, build letters and channel without semantic release numbers', () => {
	for (const [release, expected] of [
		['Soundscaper-alpha.2026.Nov.11.a', '2026.1111.0'],
		['Soundscaper-beta.2026.Nov.11.a', '2026.1111.1'],
		['Soundscaper-rc.2026.Nov.11.a', '2026.1111.2'],
		['Soundscaper.2026.Nov.11.a', '2026.1111.3'],
		['Soundscaper-alpha.2026.Nov.11.b', '2026.1111.4'],
		['Framescaper-rc.2026.Jan.2.aa', '2026.102.106'],
	]) assert.equal(calendarPackageVersion(release!), expected);
	for (const invalid of ['1.2.3', 'Soundscaper.2026.Feb.29.a', 'Soundscaper.2026.Nov.11.zzz']) {
		assert.throws(() => calendarPackageVersion(invalid), /calendar|build/iu);
	}
});
test('calendar artifact names contain the product once and retain legacy archive names when reading them', () => {
	assert.equal(releaseArtifactStem('Soundscaper-rc.2026.Nov.11.a', 'Soundscaper'), 'Soundscaper-rc.2026.Nov.11.a');
	assert.equal(releaseArtifactStem('1.0.0-rc.1', 'Soundscaper'), 'Soundscaper-1.0.0-rc.1');
	assert.throws(() => releaseArtifactStem('Framescaper.2026.Nov.11.a', 'Soundscaper'), /product/iu);
});
