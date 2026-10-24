/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readContainerVideoSourceCharacteristics } from '../src/common/editor/video-container-characteristics.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { resolveVideoDisplayGeometry } from '../src/common/editor/video-display-geometry.ts';
import { resolveVideoSourcePresentation } from '../src/common/editor/video-source-presentation.ts';
import { primaryVideoTrackFixture } from './browser/fixtures/primary-video-track-fixture.ts';

// A container default is not the browser decoder's authenticated selection:
// Chromium presents the blue default; Firefox/WebKit present the first track.
for (const primary of ['first', 'second'] as const) test(`ambiguous ${primary}-default video facts remain unknown`, async () => {
	const result = await readContainerVideoSourceCharacteristics(primaryVideoTrackFixture(primary));
	assert.deepEqual(result, normalizeVideoSourceCharacteristics({ backend: 'container', audioStreams: [] }));
	for (const presented of [{ width: 64, height: 32 }, { width: 32, height: 64 }]) {
		const geometry = resolveVideoDisplayGeometry(result, presented);
		assert.equal(geometry.reconciliation, 'unreported');
		assert.equal(geometry.displayWidth, presented.width);
		assert.equal(geometry.displayHeight, presented.height);
		assert.equal(resolveVideoSourcePresentation({ ...presented, characteristics: result }), null);
	}
});

test('a genuine single-video file retains exact coded facts', async () => {
	const result = await readContainerVideoSourceCharacteristics(primaryVideoTrackFixture('single'));
	assert.deepEqual(result, normalizeVideoSourceCharacteristics({
		backend: 'container', codedWidth: 64, codedHeight: 32, videoCodec: 'h264',
		pixelAspectRatio: { num: 1, den: 1 }, hasAlpha: false, audioStreams: [],
	}));
});

test('ambiguity never hides the complete independent audio inventory', async () => {
	const result = await readContainerVideoSourceCharacteristics(primaryVideoTrackFixture('audio'));
	assert.deepEqual(result, normalizeVideoSourceCharacteristics({
		backend: 'container',
		audioStreams: [
			{ index: 2, codec: 'aac', channelCount: 1, sampleRate: 24_000, language: 'eng' },
			{ index: 3, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'deu' },
		],
	}));
});

test('an aborted characteristics read never starts reading the media', async () => {
	const controller = new AbortController(); controller.abort();
	await assert.rejects(readContainerVideoSourceCharacteristics(primaryVideoTrackFixture('second'), {
		signal: controller.signal,
	}), { name: 'AbortError' });
});

test('cancellation during a real container read remains an AbortError', async () => {
	const controller = new AbortController();
	class RetiredFile extends File {
		override slice(start?: number, end?: number, type?: string): Blob {
			controller.abort();
			return super.slice(start, end, type);
		}
	}
	const file = primaryVideoTrackFixture('second');
	await assert.rejects(readContainerVideoSourceCharacteristics(new RetiredFile([await file.arrayBuffer()], file.name), {
		signal: controller.signal,
	}), { name: 'AbortError' });
	assert.equal(controller.signal.aborted, true);
});
