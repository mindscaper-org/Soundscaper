/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectVisualService, type ProjectVisualProject } from '../src/common/editor/controller/document/project-visual-service.ts';
import { reloadPublishedVideoVisual } from '../src/common/editor/controller/document/reload-published-video-visual.ts';
import { createSnapshotChannel } from '../src/common/editor/controller/composition/internal/snapshot-channel.ts';

for (const fail of [false, true]) {
	test(`a completed visual reload publishes its actual resource replacement, storage failure=${String(fail)}`, async () => {
		const source = { id: 'camera', kind: 'video', storageKey: 'camera-media' };
		const project: ProjectVisualProject = { id: 'project', schemaVersion: 1, sources: [source], clips: [], tracks: [] };
		const publications: Array<string | null | undefined> = [];
		const retired: string[] = [];
		let count = 0;
		let failReads = false;
		const service = createProjectVisualService({
			getProject: () => project, captureProject: () => project, assertProject() {},
			missingSourceIds: new Set(), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
			store: { loadMediaAsset: async () => {
				if (failReads) throw new Error('Media storage unavailable');
				return new Blob(['native video bytes'], { type: 'video/mp4' });
			}, listVideoDerivatives: async () => [], loadVideoDerivative: async () => null },
			projectDurationFrames: () => 48_000,
			url: { createObjectURL: () => `blob:camera-${++count}`, revokeObjectURL: value => { retired.push(value); } },
		});
		const channel = createSnapshotChannel({ build: () => service.getVideoSourceVisualData(source.id), canPublish: () => true });
		channel.subscribe(() => { publications.push(service.getVideoSourceVisualData(source.id)?.mediaUrl); });
		try {
			await service.activateVideoSource(source);
			assert.equal(service.getVideoSourceVisualData(source.id)?.mediaUrl, 'blob:camera-1');
			failReads = fail;
			const reloading = reloadPublishedVideoVisual(source.id, {
				findSource: id => project.sources.find(value => value.id === id),
				revoke: service.revokeVideoVisual, activate: service.activateVideoSource,
				publish: () => channel.publish({ force: true }),
			});
			if (fail) await assert.rejects(reloading, /Media storage unavailable/u);
			else assert.equal((await reloading)?.mediaUrl, 'blob:camera-2');
			assert.deepEqual(publications, [fail ? null : 'blob:camera-2']);
			assert.deepEqual(retired, ['blob:camera-1']);
		} finally { channel.clear(); await service.dispose(); }
	});
}
