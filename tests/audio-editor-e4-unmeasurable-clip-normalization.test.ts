/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipPropertyService, type ClipPropertyServiceDependencies } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';

for (const [duration, amplitude] of [[.1, .25], [1, 0], [1, .00001]] as const) test(`unmeasurable LUFS at ${duration}s amplitude ${amplitude} refuses without publishing gain`, async context => {
	const { service, commits } = fixture(context, duration, amplitude);
	await assert.rejects(service.handleClipAction('normalize-lufs'), error => {
		assert.ok(error instanceof RangeError);
		assert.equal(localizedErrorMessage(error)?.key, 'clipNormalizationUnmeasurable');
		return true;
	});
	assert.equal(commits.length, 0);
});

for (const [duration, action] of [[1, 'normalize-lufs'], [.1, 'normalize-peak']] as const) test(`${duration}s ${action} retains measurable normalization`, async context => {
	const { service, commits } = fixture(context, duration, .25);
	await service.handleClipAction(action);
	const command = commits[0]; assert.equal(command?.type, 'clip/update');
	if (command?.type !== 'clip/update') assert.fail('Expected gain command.');
	assert.ok(Number(command.changes.gain) > 1);
});

function fixture(context: test.TestContext, duration: number, amplitude: number) {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	context.after(() => { lifetime.beginDisposal(); lifetime.finishDisposal(); });
	const generation = new EditorProjectGeneration(); generation.activate('normalization');
	const frames = Math.round(duration * 48_000);
	const clip = createAudioClip({ id: 'clip', sourceId: 'source', gain: .5, durationFrames: frames, sourceDurationFrames: frames });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: frames, channelCount: 1 });
	const project = { id: 'normalization', schemaVersion: 23, title: 'Recording', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [] } as ClipTransformProject;
	const pcm = Float32Array.from({ length: frames }, (_, frame) => amplitude * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
	const buffer = { sampleRate: 48_000, length: frames, numberOfChannels: 1, getChannelData: () => pcm };
	const commits: AudioEditorCommand[] = [];
	const dependencies: ClipPropertyServiceDependencies = { lifetime,
		copy: { audioClipNotFound: '', clipPitchRange: '', clipSpeedPositive: '', timelineFramesFinite: '' },
		sourceBuffers: new Map([['source', buffer]]), getProject: () => project, getSelectedClipId: () => 'clip', editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => { generation.assertCurrent(token); }, createId: prefix => prefix,
		commit: command => { commits.push(command); },
		analyzeChannels: async (channels, rate) => {
			const result = analyzeAudioChannels([...channels], rate);
			assert.ok('peakAmplitude' in result && typeof result.peakAmplitude === 'number');
			return { peakAmplitude: result.peakAmplitude, integratedLufs: result.integratedLufs };
		},
	};
	return { service: createClipPropertyService(dependencies), commits };
}
