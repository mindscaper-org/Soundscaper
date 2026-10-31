/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	currentMotionReferenceTarget,
	motionReferenceDecoderName,
	requireMotionReferenceHost,
} from '../scripts/lib/motionscaper-reference-target.ts';
import type { MotionNativeTarget } from '../scripts/lib/motionscaper-native-source.ts';

const targets: readonly Readonly<{ target: MotionNativeTarget; platform: NodeJS.Platform; arch: string; decoder: string }>[] = [
	{ target: 'linux-x64', platform: 'linux', arch: 'x64', decoder: 'motion-reference-decoder' },
	{ target: 'linux-arm64', platform: 'linux', arch: 'arm64', decoder: 'motion-reference-decoder' },
	{ target: 'win-x64', platform: 'win32', arch: 'x64', decoder: 'motion-reference-decoder.exe' },
	{ target: 'win-arm64', platform: 'win32', arch: 'arm64', decoder: 'motion-reference-decoder.exe' },
	{ target: 'mac-arm64', platform: 'darwin', arch: 'arm64', decoder: 'motion-reference-decoder' },
];

for (const fixture of targets) {
	test(`independent reference decoder admits its actual ${fixture.target} host and executable suffix`, () => {
		assert.equal(currentMotionReferenceTarget(fixture.platform, fixture.arch), fixture.target);
		assert.doesNotThrow(() => { requireMotionReferenceHost(fixture.target, fixture.platform, fixture.arch); });
		assert.equal(motionReferenceDecoderName(fixture.target), fixture.decoder);
	});
}

test('independent reference artifact refuses cross-host, foreign architecture and unsupported targets', () => {
	for (const fixture of targets) {
		assert.throws(() => { requireMotionReferenceHost(fixture.target, fixture.platform, fixture.arch === 'x64' ? 'arm64' : 'x64'); }, /native target/u);
		assert.throws(() => { requireMotionReferenceHost(fixture.target, 'freebsd', fixture.arch); }, /native target/u);
	}
	for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'ia32'], ['win32', 'ia32'], ['freebsd', 'x64']] as const) {
		assert.throws(() => currentMotionReferenceTarget(platform, arch), /unsupported/u);
	}
	assert.throws(() => motionReferenceDecoderName('win-ia32' as MotionNativeTarget), /unsupported/u);
});
