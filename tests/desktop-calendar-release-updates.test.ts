/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseChecker, selectUpdate } from '../desktop/update-check.ts';
import { compareVersions } from '../src/common/release/release-version.ts';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function release(tag_name: string, prerelease = false, draft = false) { return { tag_name, prerelease, draft }; }

test('named calendar versions order years, calendar months, numeric days, and build letters', () => {
	const pairs = [
		['Soundscaper.2026.Dec.31.zz', 'Soundscaper-alpha.2027.Jan.1.a'],
		['Soundscaper.2026.Nov.9.z', 'Soundscaper-alpha.2026.Nov.10.a'],
		['Soundscaper.2026.Nov.11.a', 'Soundscaper.2026.Nov.11.b'],
		['Soundscaper.2026.Nov.11.z', 'Soundscaper.2026.Nov.11.aa'],
		['Soundscaper.2026.Nov.11.az', 'Soundscaper.2026.Nov.11.ba'],
		['Soundscaper.2026.Nov.11.zz', 'Soundscaper.2026.Nov.11.aaa'],
		['Soundscaper.2028.Feb.29.z', 'Soundscaper-alpha.2028.Mar.1.a'],
		...months.slice(1).map((month, index) => [
			`Soundscaper.2026.${months[index]}.28.z`, `Soundscaper-alpha.2026.${month}.1.a`,
		]),
	];
	for (const [earlier, later] of pairs) {
		assert.equal(compareVersions(later!, earlier!), 1, `${later} follows ${earlier}`);
		assert.equal(compareVersions(earlier!, later!), -1);
		assert.equal(compareVersions(later!, later!), 0);
	}
});

test('identical calendar date/build versions rank stable above rc, beta, and alpha', () => {
	const versions = ['Soundscaper-alpha', 'Soundscaper-beta', 'Soundscaper-rc', 'Soundscaper']
		.map(name => `${name}.2026.Nov.11.a`);
	for (let left = 0; left < versions.length; left++) for (let right = 0; right < versions.length; right++) {
		assert.equal(compareVersions(versions[left]!, versions[right]!), Math.sign(left - right));
	}
	const candidates = versions.map(tag => release(tag, !tag.startsWith('Soundscaper.'))).reverse();
	assert.equal(selectUpdate(candidates, versions[0]!, 'soundscaper-v')?.tag_name, versions[3]);
	assert.equal(selectUpdate(candidates.slice().reverse(), versions[3]!, 'soundscaper-v'), null);
	assert.equal(selectUpdate([release(versions[1]!, true)], versions[2]!, 'soundscaper-v'), null);
});

test('a newer calendar preview is available to a stable build for every preview channel and legacy tag prefix', async () => {
	for (const channel of ['alpha', 'beta', 'rc']) for (const tagPrefix of ['v', 'soundscaper-v']) for (const prerelease of [false, true]) {
		const tag = `Soundscaper-${channel}.2026.Nov.12.a`;
		const checker = new ReleaseChecker({ currentVersion: 'Soundscaper.2026.Nov.11.a', tagPrefix,
			settings: { snapshot: () => ({ updatesEnabled: true, lastUpdateCheck: null }), recordUpdateCheck: async () => {} },
			fetchImpl: async () => Response.json([
				release('Framescaper.2029.Jan.1.a'), release('Soundscaper.2027.Jan.1.a', false, true),
				release('Soundscaper-rc.2026.Nov.11.a', true), release(tag, prerelease),
			]),
		});
		assert.deepEqual(await checker.check(), { status: 'available', version: tag, prerelease: true });
		assert.equal(checker.availableVersion, tag);
		assert.equal(checker.availableRelease?.tag_name, tag);
	}
});

test('calendar previews do not downgrade stable builds on the same or an earlier date', () => {
	for (const channel of ['alpha', 'beta', 'rc']) {
		assert.equal(selectUpdate([
			release(`Soundscaper-${channel}.2026.Nov.10.z`, true),
			release(`Soundscaper-${channel}.2026.Nov.11.a`, true),
		], 'Soundscaper.2026.Nov.11.a', 'soundscaper-v'), null);
	}
});

test('calendar update selection handles migration from legacy versions and preserves product isolation', () => {
	const soundscaper = release('Soundscaper-alpha.2026.Nov.11.a', true);
	const framescaper = release('Framescaper-rc.2026.Nov.12.a', true);
	assert.equal(selectUpdate([soundscaper, framescaper], '1.0.0', 'v'), soundscaper);
	assert.equal(selectUpdate([soundscaper, framescaper], '1.0.0', 'soundscaper-v'), soundscaper);
	assert.equal(selectUpdate([soundscaper, framescaper], '1.0.0', 'framescaper-v'), framescaper);
	assert.equal(selectUpdate([release('v9.0.0')], soundscaper.tag_name, 'v'), null);
});

test('malformed calendar versions and impossible dates never become updates', () => {
	for (const value of [
		'Soundscaper.2026.Feb.29.a', 'Soundscaper.2026.Apr.31.a', 'Soundscaper.2026.Nov.0.a',
		'Soundscaper.2026.Nov.32.a', 'Soundscaper.2026.Nope.11.a', 'Soundscaper.2026.Nov.11.',
		'Soundscaper-gamma.2026.Nov.11.a', 'Soundscaper.2026.Nov.11.a/other',
	]) {
		assert.equal(selectUpdate([release(value)], 'Soundscaper-alpha.2026.Jan.1.a', 'soundscaper-v'), null, value);
		assert.throws(() => compareVersions(value, 'Soundscaper.2026.Jan.1.a'), /version/iu);
	}
});
