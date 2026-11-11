/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

void test('foreground cancellation releases the dialog while an admitted publication finishes without publishing stale state', async () => {
	const fixture = createFixture();
	const taskProgress = createEditorTaskProgressCoordinator();
	const admitted = deferred();
	const completion = deferred();
	const service = createEditorExportService({
		...fixture.runtime, taskProgress,
		fileService: { async createDownload(request: Record<string, unknown>) {
			admitted.resolve();
			await completion.promise;
			return fixture.runtime.fileService.createDownload(request);
		} },
	});
	const exporting = service.handleExportAction('export');
	await admitted.promise;
	assert.equal(taskProgress.cancelActive(), true);
	try {
		assert.equal(taskProgress.getSnapshot(), null);
		assert.equal(fixture.state.exportAbort, null);
		assert.equal(fixture.calls.includes('toggle:false'), true);
	} finally { completion.resolve(); await exporting; }
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.some(([, tone]) => tone === 'success'), false);
	assert.equal(fixture.calls.includes('download-cleanup'), true);
});
