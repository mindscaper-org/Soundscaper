/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createProjectBinLinkedAudioRelinkService } from '../src/common/editor/controller/import/internal/project-bin/project-bin-linked-audio-relink-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import type { AudioTrackFreezeCoordinatorCommandV21 } from '../src/common/editor/audio-track-freeze-coordinator-v21.ts';

for (const mode of ['frozen-changed', 'frozen-exact', 'unhashed-changed'] as const) test(`linked relink preserves authenticated source integrity for ${mode}`, async context => {
	const original = wav(.25), replacement = mode === 'frozen-exact' ? original : wav(-.5);
	const port: LinkedOriginalPort = { load(_kind, id) {
		return { blob: id === 'original_locator_00001' ? original : replacement, locatorRevision: `${id}_revision` };
	}, release() { return true; } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name, linkedOriginalPort: port }); await store.ready();
	const source = createAudioSource({ id: 'linked', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1, frameCount: 4800, chunkFrames: 65_536 });
	await store.bindLinkedAudioOriginal('project', source, 'original_locator_00001', { expectedSnapshot: original });
	let current = createSoundscaperProject({ id: 'project', sources: [source], clips: [createAudioClip({
		id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800,
	})], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: [createEffect('lowpass')] })],
	projectBin: { clips: [createAudioClip({ id: 'bin', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] } });
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const freeze = createSoundscaperAudioFreezeActions({ store, playback }, {
		get project() { return current; }, actions: { edit: { commit(command: AudioTrackFreezeCoordinatorCommandV21) {
			current = applySoundscaperProjectCommand(current, command); return current;
		} } },
	}, { createId: kind => kind === 'source' ? 'frozen' : 'frozen-clip', createRenderEngine: () => ({
		loadProject() { /* Native freeze coordination/storage remain real; only DSP is isolated. */ },
		async renderTrack(_id, options = {}) { return { channels: [new Float32Array(Number(options.outputFrames)).fill(.25)] }; },
		async dispose() { /* no owned native resources */ },
	}) });
	const lifetime = new EditorControllerLifetime(), generation = new EditorProjectGeneration(); generation.activate(current.id);
	const relink = createProjectBinLinkedAudioRelinkService({
		lifetime, missingSourceIds: new Set(), editingBlocked: () => false, getProject: () => current,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		getLinkedOriginalBinding: (projectId, sourceId) => store.getLinkedOriginalBinding(projectId, sourceId),
		digestContent: async blob => Buffer.from(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())).toString('hex'),
		admitChangedContentCandidate() { /* Same admitted WAVE geometry is asserted from the real reader below. */ },
		stopTimelinePlayback() {}, stopProjectBinPreview() {}, retireSourceChunkProvider() {}, invalidateSourceRuntime() {},
		relinkLinkedAudioOriginal: (projectId, input, locatorId, options) => store.relinkLinkedAudioOriginal(projectId, input, locatorId, options),
		releaseLinkedOriginalLocator: reference => store.releaseLinkedOriginalLocator(reference),
		getSourceMetadata: storageKey => store.getSourceMetadata(storageKey),
		activateStoredSource: async () => { assert.ok(await store.readSourceChunk(source.storageKey, 0)); return {}; }, publish() {},
	});
	context.after(async () => { await relink.dispose(); await freeze.dispose(); playback.dispose(); await store.close(); });
	if (mode !== 'unhashed-changed') { await freeze.actions.freeze('voice'); assert.equal(freeze.actions.getStatus('voice'), 'fresh'); }
	const before = structuredClone(current), oldBinding = await store.getLinkedOriginalBinding(current.id, source.id);
	const target = { projectId: current.id, projectRevision: current.revision };
	const locator = { locatorId: 'replacement_locator_001', locatorRevision: 'replacement_locator_001_revision' };
	if (mode === 'frozen-changed') {
		await assert.rejects(relink.classifyLinkedAudioRelink('bin', replacement, target), /Import.*new media/u);
		await assert.rejects(relink.relinkLinkedAudio('bin', replacement, locator, target, { allowChangedContent: true }), /Import.*new media/u);
		assert.deepEqual(await store.getLinkedOriginalBinding(current.id, source.id), oldBinding);
	} else {
		assert.equal(await relink.classifyLinkedAudioRelink('bin', replacement, target), mode === 'frozen-exact' ? 'exact-content' : 'changed-content');
		await relink.relinkLinkedAudio('bin', replacement, locator, target, { allowChangedContent: true });
		assert.equal((await store.getLinkedOriginalBinding(current.id, source.id))?.locatorId, locator.locatorId);
	}
	assert.equal((await store.readSourceChunk(source.storageKey, 0))?.channels[0]?.[0], mode === 'unhashed-changed' ? -.5 : .25);
	assert.deepEqual(current, before, 'Relink never rewrites canonical clip, freeze or source history');
	if (mode !== 'unhashed-changed') {
		assert.equal(freeze.actions.getStatus('voice'), 'fresh');
		assert.equal((await store.readSourceChunk('frozen', 0))?.channels[0]?.[0], .25);
		const archive = await exportScapeProject(current, store); assert.ok(archive.blob instanceof Blob);
	}
});

function wav(value: number): Blob {
	const bytes = encodeWav([new Float32Array(4800).fill(value)], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array); return new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
}
