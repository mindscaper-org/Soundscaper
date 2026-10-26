/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile, type ImportVideoRuntime } from '../src/common/editor/controller/import/internal/source-import.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import { createFixture } from './helpers/audio-editor-source-import-fixture.ts';
import { nativeVideoAudioTailFixture } from './helpers/native-video-audio-tail-fixture.ts';

for (const route of ['native', 'container', 'fallback'] as const) for (const picture of [1, 2] as const) {
	test(`${route} retains true audio source extent with ${picture}s picture and 2s audio`, async () => {
		const fixture = createFixture(); fixture.options.decodeMode = route;
		const pcm = new Float32Array(96_256); pcm.fill(.25, 0, 96_000);
		const decoded = buffer([pcm]);
		const runtime: ImportVideoRuntime = {
			...fixture.runtime,
			engine: { ...fixture.runtime.engine, decodeAudioData: async () => {
				if (route !== 'native') throw new Error('Use next decoder.'); return decoded;
			} },
			decodeContainerAudio: async () => {
				if (route !== 'container') throw new Error('Use next decoder.'); return { channels: [pcm], sampleRate: 48_000 };
			},
			ffmpeg: { ...fixture.runtime.ffmpeg, decode: async () => ({ channels: [pcm], sampleRate: 48_000 }) },
			bufferFromChannels: async channels => buffer(channels), canonicalizeBuffer: async value => value,
			fitAudioBufferToFrames: (value, count) => {
				const fitted = new Float32Array(count); fitted.set(value.getChannelData(0).subarray(0, count)); return buffer([fitted]);
			},
		};
		const original = Uint8Array.from(nativeVideoAudioTailFixture(picture));
		await createImportVideoFile(runtime)(new File([original.buffer], 'Programme.mp4', { type: 'video/mp4' }));
		const audio = fixture.addedSources.find(source => source.kind === 'audio');
		assert.ok(audio); assert.equal(audio.frameCount, 96_000);
		const stored = fixture.sourceBuffers.get(String(audio.id)) as AudioBufferLike;
		assert.equal(stored.getChannelData(0)[95_999], .25); assert.equal(stored.length, 96_000);
		const commands = fixture.commits[0]!.command.commands as readonly Readonly<Record<string, unknown>>[];
		const clips = commands.filter(command => command.type === 'clip/add').map(command => command.clip as Readonly<Record<string, unknown>>);
		const audioClip = clips.find(clip => clip.kind === 'audio'), videoClip = clips.find(clip => clip.kind === 'video');
		assert.equal(audioClip?.durationFrames, 48_000 * picture);
		assert.equal(videoClip?.sequenceFrameCount, 30 * picture);
		assert.equal(audioClip?.avLinkId, videoClip?.avLinkId);
	});
}

function buffer(channels: readonly Float32Array[]): AudioBufferLike {
	return { length: channels[0]!.length, sampleRate: 48_000, numberOfChannels: channels.length,
		getChannelData: channel => channels[channel]! };
}
