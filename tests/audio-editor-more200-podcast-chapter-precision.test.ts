/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelService, type LabelExportResult } from '../src/common/editor/controller/edit/internal/label-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

for (const sampleRate of [44_100, 48_000, 96_000]) test(`Podcast chapter delivery retains sample positions at ${sampleRate} Hz`, async () => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	let project = runtime.createProject({ id: `chapter-precision-${sampleRate}`, sampleRate });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	const state = { importing: false, selectedTrackId: null as string | null };
	const saved: LabelExportResult[] = []; let ordinal = 0;
	const service = createLabelService({ lifetime, projectGeneration, state, getProject: () => project,
		editingBlocked: () => false, createId: prefix => `${prefix}-${++ordinal}`,
		commit: (command, selection) => {
			project = runtime.applyCommand(project, command);
			state.selectedTrackId = selection?.selectTrackId ?? null;
		},
		publish: () => undefined, setStatus: () => undefined, saveExport: result => { saved.push(result); },
		copy: { labelTrackMissing: 'Missing', labels: 'Labels', labelsExported: 'Exported', labelsImported: 'Imported',
			labelsImportEmpty: 'Empty', labelsImporting: 'Importing', panelMarkers: 'Markers' },
	});
	const frames = [0, 1, sampleRate / 2, sampleRate / 2 + 1, sampleRate * 3600 + 1];
	const text = frames.map((frame, index) => `${frame / sampleRate}\t${frame / sampleRate}\tChapter ${index}`).join('\n');
	const imported = await service.importLabelFile(new File([text], 'Precision.txt', { type: 'text/plain' }));
	assert.deepEqual(imported?.labels.map(label => label.startFrame), frames);
	const exported = await service.exportLabels({ format: 'json' });
	assert.equal(exported.mimeType, 'application/json+chapters'); assert.deepEqual(saved, [exported]);
	const document: unknown = JSON.parse(exported.text);
	assert.ok(isRecord(document) && Array.isArray(document.chapters));
	const chapters: unknown[] = document.chapters;
	const deliveredFrames = chapters.map(chapter => {
		assert.ok(isRecord(chapter) && typeof chapter.startTime === 'number');
		return Math.round(chapter.startTime * sampleRate);
	});
	assert.deepEqual(deliveredFrames, frames, 'numeric JSON seconds must retain distinct chapter boundaries');
	assert.equal(new Set(deliveredFrames).size, frames.length);
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
