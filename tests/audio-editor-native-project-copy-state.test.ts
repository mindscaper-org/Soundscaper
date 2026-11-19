/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SaveTargetStore } from '../desktop/save-targets.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
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
			prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true } }),
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

test('Scape export releases a picked desktop target when library preparation fails', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-abandoned-save-target-'));
	const targetPath = join(directory, 'existing.sscape');
	const targets = new SaveTargetStore({ maximumTargets: 1 }), owner = {};
	t.after(async () => { targets.dispose(); await rm(directory, { recursive: true, force: true }); });
	await writeFile(targetPath, 'existing archive');
	const unexpectedWrite = () => { throw new Error('The export must not start a write after preparation fails.'); };
	const fileService = createAudioEditorFileService({ bridge: {
		chooseSaveTarget: async () => targets.registerPath(targetPath, { owner, purpose: 'project' }),
		releaseSaveTarget: async (id: string) => targets.release(id, { owner }),
		beginWrite: unexpectedWrite, writeChunk: unexpectedWrite, finishWrite: unexpectedWrite,
	} });
	const failedPreparation = new Error('Project library preparation failed.');
	const fixture = createFixture({ fileService: fileService as NativeProjectFileService,
		flushProject: async () => { throw failedPreparation; },
	});
	const service = createNativeProjectService(fixture.runtime);
	for (const attempt of [1, 2]) {
		await assert.rejects(service.saveScape(), error => error === failedPreparation,
			`attempt ${attempt} should still be able to pick the destination`);
	}
	assert.equal(await readFile(targetPath, 'utf8'), 'existing archive');
});

test('a desktop picker releases a new target when its request was cancelled while the dialog was open', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-cancelled-save-target-'));
	const targets = new SaveTargetStore({ maximumTargets: 1 }), owner = {};
	t.after(async () => { targets.dispose(); await rm(directory, { recursive: true, force: true }); });
	const entered = deferred<void>(), resume = deferred<void>();
	const controller = new AbortController();
	const service = createAudioEditorFileService({ bridge: {
		async chooseSaveTarget() {
			entered.resolve();
			await resume.promise;
			return targets.registerPath(join(directory, 'project.sscape'), { owner, purpose: 'project' });
		},
		releaseSaveTarget: async (id: string) => targets.release(id, { owner }),
		beginWrite: async () => ({}), writeChunk: async () => ({}), finishWrite: async () => ({}),
	} });
	const saving = service.prepareSave({ purpose: 'project', suggestedName: 'project.sscape', signal: controller.signal });
	await entered.promise;
	controller.abort(new DOMException('Project switched.', 'AbortError'));
	resume.resolve();
	await assert.rejects(saving, error => error === controller.signal.reason);
	const ready = await service.prepareSave({ purpose: 'project', suggestedName: 'project.sscape' });
	assert.equal(ready.mode, 'stream');
	await ready.abort();
});
