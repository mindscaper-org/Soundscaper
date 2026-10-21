/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelService } from '../src/common/editor/controller/edit/internal/label-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { parseAudioEditorLabels } from '../src/common/editor/label-io.js';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createBaselineAudioEditorProject, importBaselineScapeProject } from './helpers/baseline-scape-runtime.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

test('MI14: Export Labels resolves musical labels from an opened SCAPE through its tempo changes', async context => {
	const source = createBaselineAudioEditorProject({
		id: 'musical-label-file', title: 'Musical labels', now: '2026-10-22T00:00:00.000Z', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		] },
		tracks: [{ id: 'labels', type: 'label', name: 'Musical labels', labels: [
			{ id: 'span', title: 'Across change', anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } },
			{ id: 'point', title: 'After change', anchor: 'musical', startBeat: { num: 6, den: 1 }, endBeat: { num: 6, den: 1 } },
		] }],
	});
	const outbound = await exportScapeProject(source, createMemoryProjectStore(context, 'musical-label-export'));
	const imported: unknown = await importBaselineScapeProject(
		new File([outbound.blob], 'musical.scape'), createMemoryProjectStore(context, 'musical-label-open'),
	);
	assert.ok(isRecord(imported) && isRecord(imported.project));
	const project = createBaselineAudioEditorProject(imported.project);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	const saved: string[] = [];
	const service = createLabelService({ lifetime, projectGeneration, getProject: () => project,
		state: { importing: false, selectedTrackId: 'labels' }, editingBlocked: () => false,
		createId: prefix => prefix, commit: () => undefined, publish: () => undefined, setStatus: () => undefined,
		saveExport: result => { saved.push(result.text); },
		copy: { labelTrackMissing: '', labels: 'Labels', labelsExported: '', labelsImported: '', labelsImportEmpty: '', labelsImporting: '', panelMarkers: '' },
	});
	for (const format of ['txt', 'srt', 'vtt']) {
		const result = await service.exportLabels({ format, trackIds: ['labels'] });
		const parsed = parseAudioEditorLabels(result.text, { format, sampleRate: project.sampleRate });
		assert.deepEqual(parsed.labels.map(label => [label.title, label.startFrame, label.endFrame]), [
			['Across change', 72_000, 144_000],
			['After change', 192_000, format === 'txt' ? 192_000 : 192_048],
		]);
	}
	const podcast = await service.exportLabels({ format: 'json', trackIds: ['labels'] });
	assert.match(podcast.text, /"startTime": 1.5/u);
	assert.match(podcast.text, /"startTime": 4/u);
	assert.equal(saved.length, 4);
	assert.equal('startFrame' in project.tracks[0]!.labels[0]!, false, 'export must preserve persisted beat authority');
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
