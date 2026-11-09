/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clippingReport } from '../src/common/editor/specialized-audio-analysis.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';

for (const [sample, count] of [[32_767, 1], [-32_768, 1], [32_766, 0]] as const) {
	test(`signed PCM16 ${sample} retains exact clipping authority through WAV and Scape custody`, async context => {
		const file = pcm16Recording(sample);
		const descriptor = await inspectWavBlobPcm(file);
		assert.equal(descriptor.sampleRate, 48_000);
		assert.equal(descriptor.channelCount, 2);
		assert.equal(descriptor.frameCount, 48_000);
		const store = createMemoryProjectStore(context, `${context.name}-sender`);
		const source = createAudioSource({ id: 'recording', name: file.name, sampleRate: 48_000, channelCount: 2, frameCount: 48_000 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await streamWavBlobPcm(file, { descriptor, chunkFrames: source.chunkFrames,
			onChunk: async (channels: Float32Array[]) => { await writer.write(channels); } });
		await writer.commit();
		const project = createSoundscaperProject({ id: `clipping-custody-${sample}`, sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 48_000, durationFrames: 48_000 })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const archives = createSoundscaperScapeNativeRuntime();
		const exported = await archives.exportScapeProject(project, store);
		assert.ok(exported.blob);
		const recipient = createMemoryProjectStore(context, `${context.name}-recipient`);
		const reopened = await archives.importScapeProject(exported.blob, recipient);
		assert.equal(reopened.readOnly, false);
		const reopenedProject: unknown = reopened.project;
		assert.ok(validateSoundscaperProject(reopenedProject));
		const reopenedClip = reopenedProject.clips[0];
		assert.ok(reopenedClip?.kind === 'audio');
		const reopenedSource = reopenedProject.sources.find(value => value.id === reopenedClip.sourceId);
		assert.ok(reopenedSource?.kind === 'audio');
		assert.equal(reopenedSource.frameCount, 48_000);
		assert.equal(reopenedSource.sampleRate, 48_000);
		assert.equal(reopenedSource.channelCount, 2);
		const pcm = await readPcm(recipient, reopenedSource.storageKey);
		assert.equal(pcm.length, 2);
		for (const channel of pcm) {
			assert.equal(channel.length, 48_000);
			for (const [frame, value] of channel.entries()) {
				assert.equal(value, frame >= 12_000 && frame < 12_004 ? sample / 32_768 : 0,
					`frame ${frame} preserves the signed integer sample independently from clipping classification`);
			}
		}
		const report = clippingReport('master', { startFrame: 0, endFrame: 48_000 }, pcm.map(channel => Float32Array.from(channel)), {});
		assert.equal(report.regionCount, count);
		assert.deepEqual(report.regions, count ? [{ startFrame: 12_000, endFrame: 12_004, frameCount: 4,
			clippedSamples: 8, peakAmplitude: Math.abs(sample) / 32_768 }] : []);
	});
}

function pcm16Recording(sample: number): File {
	const bytes = new Uint8Array(44 + 48_000 * 2 * 2);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(value), offset); };
	text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
	view.setUint32(24, 48_000, true); view.setUint32(28, 48_000 * 4, true);
	view.setUint16(32, 4, true); view.setUint16(34, 16, true);
	text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
	for (let frame = 12_000; frame < 12_004; frame++) {
		for (let channel = 0; channel < 2; channel++) view.setInt16(44 + (frame * 2 + channel) * 2, sample, true);
	}
	return new File([bytes], `PCM16 ${sample}.wav`, { type: 'audio/wav' });
}
