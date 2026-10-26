/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sunPcmAu48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { partitionWorkspaceFiles, WORKSPACE_IMPORT_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';

for (const [name, type] of [['Recording.au', ''], ['Recording.snd', 'application/octet-stream']] as const) {
	test(`File Open admits the existing native audio route for ${name} without an audio MIME`, async () => {
		const original = sunPcmAu48_000Fixture();
		const file = new File([await original.arrayBuffer()], name, { type });
		const calls: unknown[] = [];
		await openWorkspaceProjectFile({ ready: Promise.resolve(), actions: { project: {
			openAudacityProject() { assert.fail('not an Audacity project'); },
			openDawproject() { assert.fail('not a DAWproject'); },
			create(options) { calls.push(options); },
			importFiles(files, options) { calls.push({ files, options }); },
		} } }, file, () => { assert.fail('not a Scape project'); });
		assert.deepEqual(calls, [{ title: 'Recording' }, { files: [file], options: { destination: 'timeline' } }]);
		assert.ok(WORKSPACE_IMPORT_FILE_ACCEPT.split(',').includes(name.endsWith('.au') ? '.au' : '.snd'));
	});
}

test('recognized AU filenames retain the media route even with a misleading text MIME', () => {
	const files = ['Recording.au', 'Recording.SND'].map(name => new File([], name, { type: 'text/plain' }));
	assert.deepEqual(partitionWorkspaceFiles(files), { projects: [], media: files, labels: [], cues: [] });
});
