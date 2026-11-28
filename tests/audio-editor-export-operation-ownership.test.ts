/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { deferred } from './helpers/async-test-control.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

test('direct Cancel aborts a video export owned by the shared export state', async () => {
	const fixture = createFixture();
	let aborted = false;
	const exportAbort = {
		signal: new AbortController().signal,
		abort: () => { aborted = true; },
	};
	fixture.state.exportAbort = exportAbort;
	const service = createEditorExportService(fixture.runtime);

	await service.handleExportAction('cancel');
	assert.equal(aborted, true);
	assert.equal(fixture.state.exportAbort, null);
});

test('cancelling an audio export retains its preparation owner until it settles', async () => {
	const fixture = createFixture();
	const entered = deferred<void>();
	const preparation = deferred<void>();
	let preparations = 0;
	const service = createEditorExportService({
		...fixture.runtime,
		prepareProjectForExport: async () => {
			preparations += 1;
			entered.resolve();
			await preparation.promise;
		},
	});
	const cancelled = service.handleExportAction('start', { format: 'wav' });
	await entered.promise;
	await service.handleExportAction('start', { format: 'wav' });
	await service.handleExportAction('cancel');
	await service.handleExportAction('start', { format: 'wav' });
	assert.equal(preparations, 1);
	preparation.resolve();
	assert.equal(await cancelled, undefined);
	await service.handleExportAction('start', { format: 'wav' });
	assert.equal(preparations, 2);
});
