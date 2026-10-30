/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { digestMediaContent } from '../src/common/media/content-digest.ts';
import { createProjectBinLinkedVideoRelinkService } from '../src/common/editor/controller/import/project-bin-linked-video-relink-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { LinkedVideoOriginalPort } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { createDeterministicSilentVideoFixture } from './browser/fixtures/deterministic-av-media.js';

for (const mode of ['authenticated-changed', 'authenticated-exact', 'legacy-changed'] as const) test(`video Relink preserves authenticated original authority: ${mode}`, async context => {
	const body = (variant: 'canonical' | 'fallback') => new Blob([Uint8Array.from(createDeterministicSilentVideoFixture('Camera.webm', { variant }).buffer)], { type: 'video/webm' });
	const original = body('canonical');
	const changedBytes = new Uint8Array(await original.arrayBuffer());
	const application = Buffer.from(changedBytes).indexOf('Chrome'); assert.ok(application >= 0);
	changedBytes[application + 5] = 0x78; // Same-size Matroska application metadata edit; every codec packet and timestamp stays intact.
	const selected = mode === 'authenticated-exact' ? original : new Blob([changedBytes], { type: original.type });
	const port: LinkedVideoOriginalPort = { load(id) {
		return { blob: id === 'original_locator_00001' ? original : selected, locatorRevision: `${id}_revision` };
	}, release() { return true; } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name, linkedVideoOriginalPort: port }); await store.ready();
	const input = { kind: 'video' as const, id: 'camera', name: 'Camera', storageKey: 'camera', mimeType: 'video/webm',
		sampleRate: 48_000, sampleFrameCount: 102_400, sourceFrameCount: 32, frameRate: { num: 15, den: 1 },
		width: 96, height: 54, hasAudio: false, videoCodec: 'vp8', audioCodec: null };
	const source = createVideoSource({ ...input, ...(mode === 'legacy-changed' ? {} : { contentSha256: await digestMediaContent(original) }) });
	const project = createFramescaperProject(PROFILE, { id: 'programme', sources: [source],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] }], primarySequenceId: 'main',
		projectBin: { clips: [{ kind: 'video', id: 'bin', sourceId: source.id, sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 64, sourceInFrame: 0, sourceFrameCount: 32 }] } });
	await store.bindLinkedVideoOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: original });
	const before = structuredClone(project), binding = await store.getLinkedVideoOriginalBinding(project.id, source.id);
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const sideEffects: string[] = [];
	const service = createProjectBinLinkedVideoRelinkService({
		lifetime: new EditorControllerLifetime(), missingSourceIds: new Set(), editingBlocked: () => false, getProject: () => project,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		getLinkedVideoOriginalBinding: (id, key) => store.getLinkedVideoOriginalBinding(id, key),
		digestContent: digestMediaContent,
		admitChangedContentCandidate() { sideEffects.push('probe'); },
		stopTimelinePlayback() { sideEffects.push('timeline'); }, stopProjectBinPreview() { sideEffects.push('preview'); },
		revokeVideoVisual() { sideEffects.push('revoke'); }, deleteVideoDerivatives() { sideEffects.push('derivatives'); },
		relinkLinkedVideoOriginal: (id, value, locator, options) => store.relinkLinkedVideoOriginal(id, value, locator, options),
		releaseLinkedVideoOriginalLocator: reference => store.releaseLinkedVideoOriginalLocator(reference),
		activateVideoSource: () => ({ mediaUrl: 'soundscaper-app://linked-video' }), publish() {},
	});
	context.after(async () => { await service.dispose(); await store.close(); });
	const relocated = { locatorId: 'selected_locator_00001', locatorRevision: 'selected_locator_00001_revision' };
	let refusal: unknown;
	try { await service.relinkLinkedVideo('bin', selected, relocated, { allowChangedContent: true }); } catch (error) { refusal = error; }
	const resolved = await store.resolveLinkedVideoOriginal(project.id, source); assert.ok(resolved);
	if (mode !== 'legacy-changed') assert.equal(await digestMediaContent(resolved.blob), source.contentSha256,
		'the active linked original must still match the immutable native source identity');
	if (mode === 'authenticated-changed') {
		assert.match(String(refusal), /Import.*new media/u);
		assert.deepEqual(await store.getLinkedVideoOriginalBinding(project.id, source.id), binding);
		assert.deepEqual(sideEffects, [], 'refuse before probe, playback, derivative or binding changes');
		await assert.rejects(service.classifyLinkedVideoRelink('bin', selected), /Import.*new media/u);
	} else {
		assert.equal(refusal, undefined);
		assert.equal((await store.getLinkedVideoOriginalBinding(project.id, source.id))?.locatorId, relocated.locatorId);
	}
	assert.deepEqual(project, before, 'Relink preserves canonical document and history');
});
