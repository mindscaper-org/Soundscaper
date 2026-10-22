/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const notices = await readFile(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8');

test('owner commands expose QA, release preparation, and soak debugging', () => {
	assert.equal(packageManifest.scripts['qa:new'], 'node scripts/create-qa-run.mjs');
	assert.equal(packageManifest.scripts['release:soundscaper:prepare'],
		'node scripts/prepare-soundscaper-release.mjs');
	assert.equal(packageManifest.scripts['debug:soak'], 'node scripts/run-soundscaper-soak.mjs');
	assert.doesNotMatch(
		JSON.stringify(packageManifest.scripts),
		/release:[^" ]*(?:admission|promot)|quality:cohort|qualification-evidence|trusted-lab|milestone5a:lab-diagnostic/iu,
	);
});

test('the fixed M5A lab and cohort harness is gone', async () => {
	for (const path of [
		'../desktop/native-helper-lab-diagnostic.ts',
		'../scripts/run-m5a-native-lab-diagnostic.mjs',
		'../tests/desktop-native-helper-lab-diagnostic.test.ts',
	]) await assert.rejects(access(new URL(path, import.meta.url)), /ENOENT/u);
});

test('the deleted severity register is not runtime-integrity evidence', async () => {
	await assert.rejects(access(new URL('../config/release-severity-policy.json', import.meta.url)), /ENOENT/u);
	const manifest = JSON.parse(await readFile(
		new URL('../config/ffmpeg-runtime-manifest.json', import.meta.url), 'utf8',
	));
	assert.equal(Object.hasOwn(manifest.evidence, 'releaseSeverityPolicy'), false);
	assert.doesNotMatch(JSON.stringify(manifest), /release-severity-policy/u);
});

test('interchange tooling dependencies retain their third-party notices', () => {
	for (const dependency of [
		'opentimelineio 0.18.1',
		'otio-cmx3600-adapter 1.0.0',
		'otio-fcpx-xml-adapter 1.0.0',
	]) assert.ok(notices.includes(dependency), `${dependency} notice is missing`);
});
