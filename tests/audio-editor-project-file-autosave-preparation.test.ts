/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectFileSaving } from '../src/common/editor/controller/document/internal/project-file-saving.ts';

for (const lostWriteAuthority of [false, true]) test(`automatic project file saving uses the prepared document, read-only=${String(lostWriteAuthority)}`, async () => {
	let project = { id: 'project', title: 'Mix', revision: 1, tracks: [{ id: 'voice', gain: 1 }] };
	let readOnly = false, scheduled: (() => void) | undefined;
	const saved: typeof project[] = [], target = { createWritable() {} };
	const saving = createProjectFileSaving({
		desktop: true, getProject: () => project,
		getOpenProjectIds: () => [project.id],
		getProjects: () => [{ project, readOnly }], getPreferences: () => ({ autoSaving: true, askBeforeClosing: true }),
		activate() {}, discard() {}, ask: async () => 'cancel',
		flushInternal: async () => {
			// Quiescing an external plug-in publishes its latest state as a new document generation.
			project = { ...project, revision: 3, tracks: [{ id: 'voice', gain: .25 }] };
			readOnly = lostWriteAuthority;
		},
		write: async value => { saved.push(value); return { fileHandle: target }; },
		prepareOriginal: async () => undefined, handleError: cause => { throw cause; },
		schedule: callback => { scheduled = callback; return 1; }, clear() {},
	});
	try {
		await saving.opened(project, { fileHandle: target });
		project = { ...project, revision: 2, title: 'Edited mix' };
		saving.observe(); assert.ok(scheduled); scheduled(); await saving.drain();
		if (lostWriteAuthority) assert.deepEqual(saved, [], 'an old writable snapshot cannot overwrite the file after a read-only transition');
		else {
			assert.equal(saved.length, 1);
			assert.equal(saved[0]!.tracks[0]!.gain, .25, 'the file must include the state prepared by its own save');
			assert.equal(await saving.hasChanges(project), false);
		}
	} finally { await saving.dispose(); }
});
