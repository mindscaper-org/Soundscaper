/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { AudioClipLeaf } from '../src/common/editor/project-media-types.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const text = readFileSync(new URL('./fixtures/aes31/voice.adl', import.meta.url), 'utf8');
function ids() { let id = 0; return (prefix: string) => `${prefix}-${++id}`; }
function companion() {
	return new File([new Uint8Array(encodeWav([new Float32Array(96_000).fill(.125), new Float32Array(96_000).fill(.5)],
		{ sampleRate: 48_000, float: true }))], 'voice.wav');
}

test('ADL companion import materializes the selected source channel and preserves edit processing', async () => {
	const fixture = createFixture({ createStableId: ids() });
	let frames = 0;
	fixture.runtime.store.beginSourceWrite = async () => ({
		write: async channels => { assert.equal(channels.length, 1); assert.equal(channels[0]![0], .5); frames += channels[0]!.length; },
		commit: async () => undefined, abort: async () => undefined,
	});
	const result = await createNativeProjectService(fixture.runtime).openInterchange(new File([text], 'Voice.ADL'), { mediaFiles: [companion()] });
	assert.ok(result); assert.equal(frames, 96_000);
	const source = result.project.sources[0]!;
	assert.ok(source.kind === 'audio'); assert.equal(source.channelCount, 1);
	const clip = result.project.clips[0] as AudioClipLeaf;
	assert.equal(clip.sourceStartFrame, 17);
	assert.equal(clip.timelineStartFrame, 7);
	assert.equal(clip.fadeInFrames, 100);
	assert.ok(Math.abs(Number(clip.gain) - .5) < 1e-12);
	assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
});

test('ADL offline sources retain their channel count and editable cuts', async () => {
	const fixture = createFixture({ createStableId: ids() });
	const result = await createNativeProjectService(fixture.runtime).openInterchange(new File([text], 'Voice.adl'));
	assert.ok(result); assert.equal(result.project.clips.length, 1);
	const source = result.project.sources[0]!;
	assert.ok(source.kind === 'audio'); assert.equal(source.channelCount, 1);
	assert.ok(result.report.items.some(item => item.disposition === 'missing'));
});

test('ADL import rejects unavailable source channels and rolls back failed activation', async () => {
	for (const unavailable of [true, false]) {
		const deleted: string[] = [];
		const fixture = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
		fixture.runtime.store.deleteSource = async id => { deleted.push(id); };
		const input = unavailable ? text.replace('0001 2 3', '0001 3 3') : text;
		await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(new File([input], 'Voice.adl'), { mediaFiles: [companion()] }),
			unavailable ? /channel selection/iu : /activation failed/iu);
		assert.equal(deleted.length, unavailable ? 0 : 1);
		assert.equal(fixture.state.importing, false);
	}
});

test('ADL channel selection also applies to streamed decoded companion audio', async () => {
	let frames = 0, disposed = false;
	const fixture = createFixture({ createStableId: ids(), prepareDawprojectAudio: async () => ({
		descriptor: { container: 'compressed-audio', frameCount: 96_000, channelCount: 2, sampleRate: 48_000, mimeType: 'audio/flac' },
		stream: async options => {
			for (let index = 0; index < 3; index++) await options.onChunk([new Float32Array(32_000).fill(.125), new Float32Array(32_000).fill(.5)]);
		}, dispose: () => { disposed = true; },
	}) });
	fixture.runtime.store.beginSourceWrite = async () => ({
		write: async channels => { assert.equal(channels.length, 1); assert.equal(channels[0]![0], .5); frames += channels[0]!.length; },
		commit: async () => undefined, abort: async () => undefined,
	});
	const result = await createNativeProjectService(fixture.runtime).openInterchange(new File([text], 'Voice.adl'), { mediaFiles: [new File(['encoded'], 'voice.wav')] });
	assert.ok(result); assert.equal(frames, 96_000); assert.equal(disposed, true);
});
