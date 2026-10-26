/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { linkedSourceContentDigest } from '../src/common/editor/linked-source-cache-content.ts';

for (const replacement of ['a', 'b']) test(`normalization ${replacement === 'a' ? 'retains exact-content relocation' : 'retires changed linked content'} after measurement`, async () => {
	const clip = { id: 'clip', sourceId: 'source', kind: 'audio' as const, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 512, durationFrames: 512, gain: .1, pitchCents: 0, speedRatio: 1, renderCacheRevision: 0 };
	const source = { id: 'source', channelCount: 1, frameCount: 512, sampleRate: 48_000 };
	const project: ClipTransformProject = { id: 'linked-normalize', schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		title: 'Linked', sampleRate: 48_000, clips: [clip], tracks: [], sources: [source] };
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const commits: AudioEditorCommand[] = [];
	let digest = 'a'.repeat(64), finish = () => {}, began = () => {};
	const measured = new Promise<void>(resolve => { began = resolve; });
	const held = new Promise<void>(resolve => { finish = resolve; });
	const store = { async getSourceMetadata() { return { storage: 'linked-audio-original-v1', sha256: digest }; } };
	const service = createClipPropertyService({ lifetime,
		copy: { audioClipNotFound: '', clipPitchRange: '', clipSpeedPositive: '', timelineFramesFinite: '' },
		sourceBuffers: new Map([['source', { length: 512, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => new Float32Array(512).fill(.5) }]]),
		getProject: () => project, getSelectedClipId: () => clip.id, editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		sourceContentIdentity: (_id, signal) => linkedSourceContentDigest(store, source, signal),
		async analyzeChannels() { began(); await held; return { peakAmplitude: .5, integratedLufs: null }; },
		createId: prefix => prefix, commit(command) { commits.push(command); },
	});
	const pending = service.handleClipAction('normalize-peak'); await measured;
	digest = replacement.repeat(64); finish();
	if (replacement === 'b') { await assert.rejects(pending, { name: 'AbortError' }); assert.deepEqual(commits, []); }
	else {
		await pending; const command = commits[0]; assert.ok(command?.type === 'clip/update');
		assert.equal(command.changes.gain, 10 ** (-1 / 20) / .5);
	}
});
