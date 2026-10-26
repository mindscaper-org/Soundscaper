/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPictureOnlyFixture } from './helpers/product-picture-export-fixture.ts';
import { installWebCodecsSupport } from './helpers/webcodecs-test-environment.ts';

let restoreWebCodecs: () => void;
test.beforeEach(() => { restoreWebCodecs = installWebCodecsSupport(); });
test.afterEach(() => { restoreWebCodecs(); });

test('product audio authority preserves generated audio detection and the explicit audio opt-out', async () => {
	for (const [withAudio, reportedAudio, includeAudio, expected] of [
		[false, true, undefined, true], [true, false, undefined, false], [false, true, false, false],
	] as const) {
		const fixture = createPictureOnlyFixture('generator', withAudio, reportedAudio);
		assert.ok(await fixture.exportVideo({ format: 'video-mp4', includeAudio }));
		assert.equal(fixture.capture.includeAudio, expected);
		assert.equal(fixture.capture.audioMix instanceof Blob, expected);
	}
});
