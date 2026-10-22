/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLabelService } from '../src/common/editor/controller/edit/internal/label-service.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
	return { promise, resolve, reject };
}

test('a late label read cannot clear the busy flag of a newer project-file import', async () => {
	const reading = deferred<ArrayBuffer>();
	const entered = deferred<void>();
	const archive = deferred<never>();
	const document = (id: string) => ({ ...project(id), sampleRate: 48_000,
		primarySequenceId: 'sequence', timelineAnnotations: [], tracks: [] });
	let active = document('project-a');
	const fixture = createFixture({
		getProject: () => active,
		importScapeProject: () => { entered.resolve(); return archive.promise; },
	});
	const labels = createLabelService({
		lifetime: fixture.lifetime, projectGeneration: fixture.projectGeneration,
		state: Object.assign(fixture.state, { selectedTrackId: null }), getProject: () => active,
		copy: { labelsImporting: 'Importing labels', labelsImported: 'Imported {count} labels',
			labelsImportEmpty: 'No labels', labelTrackMissing: 'No track', panelMarkers: 'Markers',
			labels: 'Labels', labelsExported: 'Exported {count} labels' },
		editingBlocked: () => false, createId: prefix => prefix,
		commit() { assert.fail('The old label import cannot commit into the new project.'); },
		setStatus() {}, publish() {}, saveExport: async () => undefined,
	});
	const pendingLabels = labels.importLabelFile({ name: 'old.txt', arrayBuffer: () => reading.promise });
	active = document('project-b');
	fixture.projectGeneration.activate(active.id);
	const native = createNativeProjectService(fixture.runtime);
	const pendingArchive = native.openScape(nativeFile('next.sscape'));
	await entered.promise;
	assert.equal(fixture.state.importing, true);
	reading.resolve(new TextEncoder().encode('0\t1\tOld label').buffer);
	await assert.rejects(pendingLabels, { name: 'AbortError' });
	try { assert.equal(fixture.state.importing, true, 'The archive import still owns the busy state.'); }
	finally {
		archive.reject(new DOMException('Cancel the pending archive read.', 'AbortError'));
		await assert.rejects(pendingArchive, { name: 'AbortError' });
	}
	assert.equal(fixture.state.importing, false);
});

test('a canceled old project-file read cannot unlock a newer label import', async () => {
	const reading = deferred<ArrayBuffer>();
	const entered = deferred<void>();
	const archive = deferred<never>();
	const document = (id: string) => ({ ...project(id), sampleRate: 48_000,
		primarySequenceId: 'sequence', timelineAnnotations: [], tracks: [] });
	let active = document('project-a');
	const fixture = createFixture({ getProject: () => active,
		importScapeProject: () => { entered.resolve(); return archive.promise; } });
	const native = createNativeProjectService(fixture.runtime);
	const pendingArchive = native.openScape(nativeFile('old.sscape'));
	await entered.promise;
	active = document('project-b');
	fixture.projectGeneration.activate(active.id);
	let committed = false;
	const labels = createLabelService({ lifetime: fixture.lifetime, projectGeneration: fixture.projectGeneration,
		state: Object.assign(fixture.state, { selectedTrackId: null }), getProject: () => active,
		copy: { labelsImporting: 'Importing labels', labelsImported: 'Imported {count} labels',
			labelsImportEmpty: 'No labels', labelTrackMissing: 'No track', panelMarkers: 'Markers',
			labels: 'Labels', labelsExported: 'Exported {count} labels' },
		editingBlocked: () => false, createId: prefix => prefix,
		commit() { committed = true; }, setStatus() {}, publish() {}, saveExport: async () => undefined,
	});
	const pendingLabels = labels.importLabelFile({ name: 'new.txt', arrayBuffer: () => reading.promise });
	archive.reject(new DOMException('Cancel the old project read.', 'AbortError'));
	await assert.rejects(pendingArchive, { name: 'AbortError' });
	assert.equal(fixture.state.importing, true);
	reading.resolve(new TextEncoder().encode('0\t1\tNew label').buffer);
	await pendingLabels;
	assert.equal(committed, true);
	assert.equal(fixture.state.importing, false);
});
