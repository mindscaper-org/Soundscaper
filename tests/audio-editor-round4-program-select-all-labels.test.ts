/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { registerMockModuleUrls } from './helpers/mock-module-urls.ts';
import { createMacroScriptHost } from '../src/common/editor/controller/effects/internal/macro/macro-script-host.ts';

for (const hasAudio of [true, false]) {
	test(`macro Select all includes later labels in ${hasAudio ? 'mixed' : 'label-only'} content`, async () => {
		const project = {
			id: 'session', sampleRate: 48_000,
			tracks: [
				{ id: 'voice', type: 'audio', clipIds: hasAudio ? ['recording'] : [] },
				{ id: 'cues', type: 'label', clipIds: [], labels: [{ id: 'outro', startFrame: 96_000, endFrame: 144_000 }] },
			],
			clips: hasAudio ? [{ id: 'recording', kind: 'audio', timelineStartFrame: 0, durationFrames: 38_400 }] : [],
			selection: { startFrame: 0, endFrame: 0, trackIds: [] as readonly string[] },
		};
		const selectionWrites: Array<readonly [number, number]> = [];
		const host = createMacroScriptHost({
			getProject: () => project, projectSampleRate: () => project.sampleRate,
			runEffectMacro: async () => {}, runMacroCommand: () => {}, listSavedMacros: () => [],
			setExactSelection: (startFrame, endFrame, details) => {
				selectionWrites.push([startFrame, endFrame]);
				project.selection = { startFrame, endFrame, trackIds: details?.trackIds as readonly string[] };
			},
			beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
		});
		assert.deepEqual(await host.createDispatch()('select.all', []),
			{ startFrame: 0, endFrame: 144_000, trackIds: ['voice', 'cues'] });
		assert.deepEqual(selectionWrites, [[0, 144_000]], 'the complete range is selected in one write');
	});
}


test('the real program selects the original two-second point label after stereo recording EOF without authoring', async context => {
	const hooks = registerMockModuleUrls({ '../../macro-script/browser-sandbox.ts': new URL('./helpers/macro-vm-worker-transport.ts', import.meta.url).href });
	context.after(() => { hooks.deregister(); });
	const input = selectionWav('browser-tone-a.wav', 38_400, 2, 48_000, 330);
	const f = await selectionControllerCustody(context, input), { controller } = f;
	try {
		assert.equal(await importWorkspaceRoutedFiles({ controller, files: [new File(['2\t2\tEnd cue\n'], 'cue-labels.txt', { type: 'text/plain' })],
			importOptions: {}, projectBinVisible: false, openProjectFile() { assert.fail('A TXT sidecar cannot open a project.'); },
			requestCueImport() { assert.fail('The original TXT sidecar is not CUE.'); } }), 1);
		const before = clipboardProject(controller.project), history = structuredClone(controller.getSnapshot().history);
		assert.equal(before.clips.length, 1); assert.equal(before.sources.length, 1);
		const labelTrack = before.tracks.find(track => track.type === 'label'); assert.ok(labelTrack);
		assert.ok(Array.isArray(labelTrack.labels)); assert.equal(labelTrack.labels.length, 1);
		const label: unknown = labelTrack.labels[0]; assert.ok(label && typeof label === 'object');
		assert.deepEqual([Reflect.get(label, 'title'), Reflect.get(label, 'startFrame'), Reflect.get(label, 'endFrame')], ['End cue', 96_000, 96_000]);
		const result: unknown = await controller.actions.macros.runScript({ name: 'Select all later cue', source: [
			'const selected = await sound.select.all();',
			"sound.log.info('All content ends at ' + selected.endFrame);",
		].join('\n') });
		assert.ok(result && typeof result === 'object'); assert.equal(Reflect.get(result, 'calls'), 1);
		assert.deepEqual(Reflect.get(result, 'log'), [{ level: 'info', text: 'All content ends at 96000', at: 1 }]);
		const after = clipboardProject(controller.project);
		assert.deepEqual([after.selection.startFrame, after.selection.endFrame], [0, 96_000]);
		assert.deepEqual(new Set(after.selection.trackIds), new Set(before.tracks.map(track => track.id)));
		assert.deepEqual(clipboardDocument(after), clipboardDocument(before));
		assert.deepEqual(controller.getSnapshot().history, history);
		const reopened = await f.archive();
		assert.deepEqual(clipboardDocument(reopened), clipboardDocument(before));
	} finally { await f.dispose(); }
});
