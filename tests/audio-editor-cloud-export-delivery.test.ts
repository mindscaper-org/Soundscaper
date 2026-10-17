/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { publishBufferedExport } from '../src/common/editor/controller/export/internal/buffered-export-publication.ts';
import { prepareDirectPcmExportDestination } from '../src/common/editor/controller/export/internal/direct/direct-export-dispatch.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const isDesktop of [false, true]) test(`cloud archive delivery bypasses local pickers and keeps local save state (desktop: ${isDesktop})`, async () => {
	const fixture = createFixture();
	fixture.state.saveState = 'dirty';
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected local save'); };
	const service = createNativeProjectService({ ...fixture.runtime,
		fileService: { ...fixture.runtime.fileService, isDesktop, chooseSaveTarget: unexpected, saveFile: unexpected },
		requestAup4FileHandle: unexpected,
		saveAup4Result: async (result, options) => options.fileService.saveFile({
			purpose: 'project', suggestedName: 'Session.aup4', mimeType: result.mimeType ?? 'application/octet-stream',
			blob: new Blob([new Uint8Array(result.bytes!)]), signal: options.signal,
		}),
	});
	let delivered: Blob | undefined;
	try {
		await service.saveAup4({ saveFile: async request => { delivered = request.blob; return { method: 'cloud' }; } });
		assert.ok(delivered); assert.equal(delivered.size, 1);
		assert.equal(fixture.state.saveState, 'dirty');
		await assert.rejects(service.saveAup4({ saveFile: async () => { throw new Error('Cloud unavailable'); } }), /Cloud unavailable/u);
		assert.equal(fixture.state.saveState, 'dirty');
	} finally { await service.dispose(); }
});

test('buffered audio delivery sends bytes to its callback and never asks for a local destination', async () => {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected local save'); };
	const service = { createDownload: unexpected, saveFile: unexpected };
	const blob = new Blob(['mix']);
	let delivered: unknown;
	await publishBufferedExport(service, { blob }, async (request: unknown) => { delivered = request; return {}; });
	assert.deepEqual(delivered, { blob });
	assert.deepEqual(await prepareDirectPcmExportDestination({ prepareSave: unexpected }, { format: 'wav' },
		{ saveToFile: async () => ({}) }, new AbortController().signal), { destination: null, cancelled: null });
});
