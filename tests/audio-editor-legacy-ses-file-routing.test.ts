/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { partitionWorkspaceFiles, WORKSPACE_OPEN_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { withDesktopProjectReadDescriptor } from '../src/common/editor/ui/workspace/desktop-project-file-routing.ts';
import { deferred } from './helpers/async-test-control.ts';

test('desktop File Open waits for readiness before dispatching a legacy SES session', async () => {
	const file = new File(['COOLNESS'], 'Legacy.SES');
	const ready = deferred<void>();
	const calls: string[] = [];
	const unexpected = () => assert.fail('legacy SES must use the Audition session importer');
	const controller = { ready: ready.promise, actions: { project: {
		openAudacityProject: unexpected, openDawproject: unexpected,
		openSesx: (input: File) => { assert.equal(input, file); calls.push('ses'); return 'opened'; },
	} } };
	const opening = openWorkspaceProjectFile(controller, file, unexpected, unexpected, true);
	await Promise.resolve();
	assert.deepEqual(calls, []);
	ready.resolve();
	assert.equal(await opening, 'opened');
	assert.deepEqual(calls, ['ses']);
	assert.deepEqual(partitionWorkspaceFiles([file]).projects, [file]);
});

test('browser SES routes reject without creating or importing into a project', async () => {
	const unexpected = () => assert.fail('browser SES rejection must preserve the open project');
	const controller = { ready: Promise.resolve(), actions: { project: {
		openAudacityProject: unexpected, openDawproject: unexpected, openSesx: unexpected,
		create: unexpected, importFiles: unexpected,
	} } };
	await assert.rejects(openWorkspaceProjectFile(controller, new File(['COOLNESS'], 'Legacy.ses'), unexpected), /SES.*desktop/iu);
	assert.ok(!WORKSPACE_OPEN_FILE_ACCEPT.split(',').includes('.ses'));
});

test('an unavailable desktop SES importer reports the session format', async () => {
	const unexpected = () => assert.fail('legacy SES must not use another importer');
	await assert.rejects(openWorkspaceProjectFile({ ready: Promise.resolve(), actions: { project: {
		openAudacityProject: unexpected, openDawproject: unexpected,
	} } }, new File(['COOLNESS'], 'Legacy.ses'), unexpected, unexpected, true), /SES.*unavailable/iu);
});

test('an oversized SES descriptor is rejected before binary materialization and retires both grants', async () => {
	const calls: string[] = [];
	const descriptor = { id: 'a'.repeat(64), readProfile: 'selected-range-v1', name: 'Legacy.SES',
		mimeType: 'application/octet-stream', size: 32 * 1024 * 1024 + 1 };
	const unexpected = async () => { throw new Error('oversized SES must not be read'); };
	await assert.rejects(withDesktopProjectReadDescriptor({
		withScapeReadDescriptor: unexpected, withReadDescriptors: unexpected,
		releaseRead: async (id: string) => { calls.push(`read:${id}`); },
		releaseSesxSession: async (id: string) => { calls.push(`session:${id}`); },
	}, descriptor, { openMaterialized: unexpected, openScape: unexpected }), /SES.*32 MiB.*binary/iu);
	assert.deepEqual(calls, [`read:${descriptor.id}`, `session:${descriptor.id}`]);
});

test('SES materialization and import failures always retire the scoped media session', async () => {
	for (const failsToRead of [true, false]) {
		const calls: string[] = [];
		const descriptor = { id: 'a'.repeat(64), readProfile: 'selected-range-v1', name: 'Legacy.ses', size: 8 };
		const failure = new Error(failsToRead ? 'binary read failed' : 'session import failed');
		await assert.rejects(withDesktopProjectReadDescriptor({
			withScapeReadDescriptor: async () => { throw new Error('unexpected Scape read'); },
			withReadDescriptors: async (_descriptors: readonly unknown[], _request: unknown,
				consume: (files: readonly Blob[]) => Promise<never>) => {
				if (failsToRead) throw failure;
				return consume([new File(['COOLNESS'], 'Legacy.ses')]);
			},
			releaseSesxSession: async (id: string) => { calls.push(id); },
		}, descriptor, {
			openMaterialized: async () => { throw failure; },
			openScape: async () => { throw new Error('unexpected Scape consumer'); },
		}), failure);
		assert.deepEqual(calls, [descriptor.id]);
	}
});
