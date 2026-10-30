/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForCommand } from '../src/common/editor/command-project-view.ts';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { analyzeClipNormalizationChannels } from '../src/common/editor/controller/clip-video/internal/clip-normalization-analysis.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('actual Normalize Peak emits the exact gain without constructing K-weighting or true-peak meters', async () => {
	const frames = 48_000, lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const project = createSoundscaperProject({ id: 'sample-peak-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 2, frameCount: frames }],
		tracks: [{ id: 'track', clipIds: ['clip'] }], clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: frames, durationFrames: frames, timelineStartFrame: 0, gain: 0.4 }] });
	const view = projectForCommand(project), generation = new EditorProjectGeneration(); generation.activate(project.id);
	const channels = [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(-0.75)];
	const commits: AudioEditorCommand[] = [];
	const service = createClipPropertyService({ lifetime, copy: ENGLISH_COPY,
		sourceBuffers: new Map([['source', { sampleRate: 48_000, length: frames, numberOfChannels: 2, getChannelData: (channel: number) => channels[channel]! }]]),
		getProject: () => view as unknown as ClipTransformProject, getSelectedClipId: () => 'clip', editingBlocked: () => false,
		captureProject: () => generation.capture(project.id), assertProject: token => generation.assertCurrent(token), createId: prefix => prefix,
		commit: command => { commits.push(command); }, analyzeChannels: (pcm, rate, signal, peakOnly) => analyzeClipNormalizationChannels(pcm, rate, ENGLISH_COPY, signal, peakOnly) });
	const tan = Math.tan;
	let meters = 0;
	Math.tan = value => { meters++; return tan(value); };
	try {
		await service.handleClipAction('normalize-peak');
		assert.deepEqual(commits, [{ type: 'clip/update', clipId: 'clip', changes: { gain: 10 ** (-1 / 20) / 0.75 } }]);
		assert.equal(meters, 0, `${meters} K-weighting coefficient preparations`);
	} finally { Math.tan = tan; }
	assert.equal(project.clips[0]!.gain, 0.4);
});

test('peak-only analysis preserves silence, mono and multichannel finite-sample admission', async () => {
	for (const channels of [[new Float32Array(16)], [Float32Array.of(-0.25, 0.5)], Array.from({ length: 10 }, (_, index) => Float32Array.of(index / 10, -index / 10))]) {
		const expected = Math.max(0, ...channels.flatMap(channel => [...channel].map(Math.abs)));
		assert.deepEqual(await analyzeClipNormalizationChannels(channels, 48_000, ENGLISH_COPY, new AbortController().signal, true), { peakAmplitude: expected, integratedLufs: null });
	}
	await assert.rejects(analyzeClipNormalizationChannels([Float32Array.of(NaN)], 48_000, ENGLISH_COPY, new AbortController().signal, true), /finite/);
	const abort = new AbortController(); abort.abort(new Error('cancelled sample peak'));
	await assert.rejects(analyzeClipNormalizationChannels([Float32Array.of(0.5)], 48_000, ENGLISH_COPY, abort.signal, true), { name: 'AbortError' });
});


test('full loudness normalization retains its actual EBU path', async () => {
	const channels = [new Float32Array(16_000).fill(0.25)];
	const tan = Math.tan;
	let meters = 0;
	Math.tan = value => { meters++; return tan(value); };
	try {
		const result = await analyzeClipNormalizationChannels(channels, 8_000, ENGLISH_COPY, new AbortController().signal, false);
		assert.equal(result.peakAmplitude, 0.25);
		assert.equal(typeof result.integratedLufs, 'number');
		assert.ok(meters > 0);
	} finally { Math.tan = tan; }
});
