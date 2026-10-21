/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioGeneratorService } from '../src/common/editor/controller/edit/generator-service.ts';
import { createAudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';
import { createWaveformPeakBuilder } from '../src/common/editor/waveform-peak-builder.ts';
import { createFixture, project } from './helpers/audio-editor-generator-service-fixture.ts';

test('Edit Silence streams a multichannel selected minute without constructing a whole-source AudioBuffer', async () => {
	const frames = 60 * 48_000;
	const base = project();
	const selected = { ...base, sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: frames, trackIds: ['track-a'] },
		sources: [{ id: 'existing-source', channelCount: 8 }],
		clips: [{ ...base.clips[0]!, durationFrames: frames, sourceDurationFrames: frames }],
	};
	let written = 0;
	let closed = 0;
	let starts = 0;
	const fixture = createFixture({
		getProject: () => selected,
		trackChannelCount: () => 8,
		getAudioContext: () => { throw new Error('Long silence must not allocate a whole-source AudioBuffer.'); },
		generateStream: async (type, options) => {
			starts++;
			const renderer = createAudioEditorSignalRenderer(type, options);
			const peaks = createWaveformPeakBuilder(renderer);
			return { type, sampleRate: renderer.sampleRate, frameCount: renderer.frameCount, channelCount: renderer.channelCount,
				async *chunks() {
					for (let channels = renderer.next(65_536); channels; channels = renderer.next(65_536)) {
						peaks.append(channels); yield channels;
					}
				},
				finish: async () => peaks.finish(), close() { closed++; },
			};
		},
		store: {
			async beginSourceWrite() { return {
				write(channels) {
					assert.equal(channels.length, 8);
					assert.ok(channels[0]!.length <= 65_536);
					assert.equal(channels.every(channel => channel.every(value => value === 0)), true);
					written += channels[0]!.length;
				}, commit() {}, abort() {},
			}; },
			async saveAnalysis() {}, async deleteSource() {},
		},
	});
	assert.equal(await createAudioGeneratorService(fixture.dependencies).generateSelectionSilence(), true);
	assert.equal(starts, 1);
	assert.equal(closed, 1);
	assert.equal(written, frames + 1);
	assert.deepEqual(fixture.preflights, [(frames + 1) * 8 * 4]);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});
