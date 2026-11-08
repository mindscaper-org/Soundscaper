/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { main } from '../scripts/motionscaper-reference-artifact-build.ts';
import { main as prefixAuthority } from '../scripts/motionscaper-reference-prefix-authority.ts';
import { currentMotionReferenceTarget } from '../scripts/lib/motionscaper-reference-target.ts';

test('reference artifact CLI refuses foreign targets before inspecting build inputs', async () => {
	const current = currentMotionReferenceTarget();
	for (const target of ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64', 'mac-arm64']) {
		if (target === current) continue;
		await assert.rejects(main([`--target=${target}`, '--native-result=/absent-result', '--ffmpeg-prefix=/absent-prefix', '--output=/absent-output']), /matching native target/u);
	}
});

test('reference artifact CLI requires an independent expected digest paired with its authority', async () => {
	const args = [`--target=${currentMotionReferenceTarget()}`, '--native-result=/absent-result', '--ffmpeg-prefix=/absent-prefix', '--output=/absent-output'];
	await assert.rejects(main([...args, '--prefix-authority=/authority']), /supplied together/u);
	await assert.rejects(main([...args, `--prefix-authority-sha256=${'a'.repeat(64)}`]), /supplied together/u);
	await assert.rejects(main([...args, '--prefix-authority=/authority', '--prefix-authority-sha256=invalid']), /supplied together/u);
});

test('reference prefix producer requires explicit inputs and the actual native host before prefix traversal', async () => {
	await assert.rejects(prefixAuthority([]), /requires its own target/u);
	const other = currentMotionReferenceTarget() === 'win-x64' ? 'mac-arm64' : 'win-x64';
	await assert.rejects(prefixAuthority([`--target=${other}`, '--native-result=/absent-result', '--native-work=/absent-work', '--output=/absent-output']), /matching native target/u);
});
