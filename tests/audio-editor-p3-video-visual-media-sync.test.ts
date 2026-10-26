/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectVisualService, type ProjectVisualProject } from '../src/common/editor/controller/document/project-visual-service.ts';

function fixture() {
	let project: ProjectVisualProject = { id: 'project', schemaVersion: 1, sources: [{ id: 'camera', kind: 'video', storageKey: 'original' }], clips: [], tracks: [] };
	let next = 0;
	const urls = new Map<string, Blob>(), revoked: string[] = [], reads: string[] = [];
	let held: { resolve: (value: Blob) => void; promise: Promise<Blob> } | null = null;
	const service = createProjectVisualService({
		getProject: () => project, captureProject: () => project.id, assertProject: token => { assert.equal(token, project.id); },
		missingSourceIds: new Set(), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		projectDurationFrames: () => 48_000,
		store: { async loadMediaAsset(key) { reads.push(key); return key === 'trimmed' && held ? held.promise : new Blob([key]); },
			listVideoDerivatives: async () => [], loadVideoDerivative: async () => null },
		url: { createObjectURL(blob) { const url = `blob:${++next}`; urls.set(url, blob); return url; },
			revokeObjectURL(url) { revoked.push(url); } },
	});
	return { service, reads, revoked,
		async activate() { assert.ok(project.sources[0]); await service.activateVideoSource(project.sources[0]); },
		change(storageKey: string) { project = { ...project, sources: [{ ...project.sources[0]!, storageKey }] }; },
		hold() { let resolve!: (value: Blob) => void; const promise = new Promise<Blob>(done => { resolve = done; }); held = { resolve, promise }; return held; },
		async body() { const url = service.getVideoSourceVisualData('camera')?.mediaUrl; assert.ok(url); const blob = urls.get(url); assert.ok(blob); return blob.text(); },
	};
}

test('rewritten video media follows Undo while the trimmed body is still loading', async () => {
	const f = fixture();
	try {
		await f.activate(); f.change('trimmed'); const held = f.hold();
		const trimming = f.service.synchronizeVideoSources();
		f.change('original'); assert.equal(await f.service.synchronizeVideoSources(), true);
		assert.equal(await f.body(), 'original');
		held.resolve(new Blob(['trimmed'])); assert.equal(await trimming, false);
		assert.equal(await f.body(), 'original');
		assert.deepEqual(f.reads, ['original', 'trimmed', 'original']);
	} finally { await f.service.dispose(); }
});

test('ordinary edits with unchanged video media preserve their URL and avoid storage reads', async () => {
	const f = fixture();
	try {
		await f.activate(); f.change('original');
		assert.equal(await f.service.synchronizeVideoSources(), false);
		assert.equal(await f.body(), 'original');
		assert.deepEqual(f.reads, ['original']); assert.deepEqual(f.revoked, []);
	} finally { await f.service.dispose(); }
});

test('disposal during a media rewrite cannot republish the retired decoder', async () => {
	const f = fixture();
	await f.activate(); f.change('trimmed'); const held = f.hold();
	const pending = f.service.synchronizeVideoSources();
	await f.service.dispose(); held.resolve(new Blob(['trimmed']));
	assert.equal(await pending, false);
	assert.equal(f.service.getVideoSourceVisualData('camera')?.mediaUrl, null);
	assert.deepEqual(f.revoked, ['blob:1']);
});
