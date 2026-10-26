/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { BlobSource, Input, OGG } from 'mediabunny';
import { inspectOggGaplessGeometry } from '../src/common/editor/ogg-gapless-import.ts';
import { chainedOpusFixture, multiplexedOpusFixture } from './helpers/ogg-multiplexed-tail-fixture.ts';
import { createController, createTwoTrackFixture } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

test('Ogg import refuses to silently discard a later sequential audio link', async () => {
	const fixture = await chainedOpusFixture();
	const input = new Input({ source: new BlobSource(new Blob([fixture.chained])), formats: [OGG] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		assert.ok(await track.computeDuration() * 48_000 < fixture.frames,
			'the maintained decoder exposes only the first link, so import must refuse partial audio');
	} finally { input.dispose(); }
	await assert.rejects(inspectOggGaplessGeometry(new Blob([fixture.chained]), 'opus'), /chained.*Split/iu);
	assert.deepEqual(await inspectOggGaplessGeometry(new Blob([fixture.first]), 'opus'), { sampleRate: 48_000, sourceFrames: 48_001 });
});

test('File Import retains no partial source after chained-audio refusal and allows a complete single link', async () => {
	const fixture = await chainedOpusFixture();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (value, init) => value instanceof URL && value.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(value))) : originalFetch(value, init);
	const { store } = await createTwoTrackFixture('next-ogg-chained-import', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	const messages: string[] = [];
	const unsubscribe = controller.subscribe(() => { messages.push(controller.getSnapshot().status.message); });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([fixture.chained], 'Radio.opus', { type: 'audio/ogg' })], { destination: 'timeline' });
		assert.equal(controller.getSnapshot().status.state, 'error');
		assert.ok(messages.some(message => /chained.*Split/iu.test(message)), 'the refusal reaches the public controller error presentation');
		let project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 0); assert.equal(project.clips.length, 0);
		await controller.actions.project.importFiles([new File([fixture.first], 'Single.opus', { type: 'audio/ogg' })], { destination: 'timeline' });
		project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources[0]?.frameCount, 48_001); assert.equal(project.clips[0]?.durationFrames, 48_001);
	} finally { unsubscribe(); await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('chained-audio admission follows bounded headers past another concurrent stream and honors cancellation', async () => {
	const fixture = await chainedOpusFixture(), multiplexed = await multiplexedOpusFixture();
	const file = new Blob([multiplexed.multiplexed, fixture.chained.subarray(fixture.first.length)]);
	await assert.rejects(inspectOggGaplessGeometry(file, 'opus'), /chained.*Split/iu);
	const abort = new AbortController();
	class CancelledBlob extends Blob {
		override slice(start = 0, end = this.size, type?: string): Blob {
			if (start === fixture.first.length && end - start === 27) abort.abort(new DOMException('Stopped chained scan.', 'AbortError'));
			return super.slice(start, end, type);
		}
	}
	await assert.rejects(inspectOggGaplessGeometry(new CancelledBlob([fixture.chained]), 'opus', abort.signal), /Stopped chained scan/u);
});
