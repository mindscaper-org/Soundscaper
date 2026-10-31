/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { authoredClipPropertyInput } from './browser/helpers/authored-clip-properties.ts';

const clock = { upstreamNumber: true, projectSampleRate: 48_000, sourceSampleRate: 44_100 };

test('authored source trims retain their own clock beside project duration and fades', () => {
	assert.equal(authoredClipPropertyInput('sourceInFrame', 4_410, clock), 0.1);
	assert.equal(authoredClipPropertyInput('sourceStartFrame', 4_410, clock), 0.1);
	assert.equal(authoredClipPropertyInput('startFrame', 4_410, clock), 0.091875);
	assert.equal(authoredClipPropertyInput('durationFrame', 43_201, clock), 0.9000208333333334);
	assert.equal(authoredClipPropertyInput('fadeInFrame', 600, clock), 0.0125);
	assert.equal(authoredClipPropertyInput('fadeOutFrames', 1_800, clock), 0.0375);
});
test('cents and speed ratio retain independent literal display meanings', () => {
	assert.equal(authoredClipPropertyInput('pitchCents', 300, clock), 3);
	assert.equal(authoredClipPropertyInput('pitchCents', 1_200, { ...clock, pitchPercent: true }), 100);
	assert.equal(authoredClipPropertyInput('pitchCents', -1_200, { ...clock, pitchPercent: true }), -50);
	assert.equal(authoredClipPropertyInput('speedRatio', 0.5, clock), 50);
	assert.equal(authoredClipPropertyInput('speedRatio', 2, clock), 200);
});
test('native mixed/video/generator timing and speed keep sample and ratio inputs', () => {
	const native = { upstreamNumber: false };
	for (const [field, value] of [['sourceInFrame', 4_410], ['durationFrame', 96_000], ['speedRatio', 2]] as const) {
		assert.equal(authoredClipPropertyInput(field, value, native), value);
	}
	assert.equal(authoredClipPropertyInput('pitchCents', 300, native), 3);
	assert.equal(authoredClipPropertyInput('pitchCents', 1_200, { ...native, pitchPercent: true }), 100);
});
test('numeric clocks cannot silently assume a project or source sample rate', () => {
	assert.throws(() => authoredClipPropertyInput('sourceInFrame', 1, { upstreamNumber: true, projectSampleRate: 48_000 }), /actual sample rate/u);
	assert.throws(() => authoredClipPropertyInput('durationFrame', 1, { upstreamNumber: true, sourceSampleRate: 44_100 }), /actual sample rate/u);
});
