/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelService } from '../src/common/editor/controller/edit/internal/label-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

test('MI10: ordinary imported label decimal times round exactly at 44.1 kHz half samples', async () => {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('p');
	let nextId = 0;
	const project = { id: 'p', title: 'Project', sampleRate: 44_100, primarySequenceId: 'main', timelineAnnotations: [], tracks: [] };
	const service = createLabelService({ lifetime, projectGeneration,
		getProject: () => project,
		state: { importing: false, selectedTrackId: null }, editingBlocked: () => false,
		createId: prefix => `${prefix}-${++nextId}`, commit: () => undefined, publish: () => undefined,
		setStatus: () => undefined, saveExport: () => undefined,
		copy: { labelTrackMissing: '', labels: 'Labels', labelsExported: '', labelsImported: '', labelsImportEmpty: '', labelsImporting: '', panelMarkers: '' },
	});
	for (const [extension, text] of [
		['srt', '1\n00:00:00,175 --> 00:00:00,285\nCaption\n'],
		['vtt', 'WEBVTT\n\n00:00.175 --> 00:00.285\nCaption\n'],
		['txt', '0.175\t0.285\tCaption\n'],
	]) {
		const result = await service.importLabelFile(new File([text ?? ''], `captions.${extension ?? 'txt'}`));
		assert.ok(result);
		assert.equal(result.labels[0]?.startFrame, 7_718);
		assert.equal(result.labels[0]?.endFrame, 12_569);
	}
	const beforeHalf = await service.importLabelFile(new File(['0.17499999999999999\tCaption\n'], 'precise.txt'));
	assert.equal(beforeHalf?.labels[0]?.startFrame, 7_717);
});
