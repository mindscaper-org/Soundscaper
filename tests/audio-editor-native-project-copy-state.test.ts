/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { deferred } from './helpers/async-test-control.ts';
import { createFixture, project } from './helpers/native-project-service-fixture.ts';

async function savingOpaqueCopy() {
	const entered = deferred<void>(), resume = deferred<void>();
	const archive = new File([Uint8Array.of(80, 75, 3, 4, 42)], 'future.scape', { type: 'application/vnd.soundscaper.scape+zip' });
	const fixture = createFixture({
		importScapeProject: async () => ({ project: { ...project('future'), schemaVersion: 16 }, readOnly: true, manifest: {} }),
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => ({ browserDownload: true }),
			prepareSave: async () => ({ mode: 'blob', target: { browserDownload: true } }),
			async saveFile(request) { entered.resolve(); await resume.promise; return { fileName: request.suggestedName, size: request.blob.size }; },
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	await service.openScape(archive);
	fixture.state.readOnly = true;
	const copying = service.saveScape({ saveCopy: true, useFileSystemAccess: false });
	await entered.promise;
	return { fixture, copying, resume };
}

test('a completed copy of a future project does not publish success in a different tab', async () => {
	const { fixture, copying, resume } = await savingOpaqueCopy();
	const statusesBeforeSwitch = fixture.statuses.length;
	fixture.replaceProject('other-project');
	resume.resolve();
	assert.ok('manifest' in await copying, 'the already published copy still gets its receipt');
	assert.equal(fixture.statuses.length, statusesBeforeSwitch);
});

test('an opaque Save Copy reports active file work until the native destination confirms publication', async () => {
	const { fixture, copying, resume } = await savingOpaqueCopy();
	const duringCopy = fixture.state.saveState;
	resume.resolve();
	await copying;
	assert.equal(duringCopy, 'saving');
	assert.equal(fixture.state.saveState, 'saved');
});

test('saving a copy of a stale read-only project preserves unsaved library changes', async () => {
	const fixture = createFixture();
	fixture.state.readOnly = true;
	fixture.state.saveState = 'dirty';
	await createNativeProjectService(fixture.runtime).saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.equal(fixture.state.saveState, 'dirty');
});
