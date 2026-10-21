/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { useExportDialogOutput } from '../src/common/editor/ui/use-export-dialog-output.ts';
import { exportDialogHasChapterLabels, exportDialogHasDeliveredChapterLabels } from '../src/common/editor/ui/export-dialog-embedded-chapters.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = { sampleRate: 48_000, primarySequenceId: 'main',
	sequences: [{ id: 'main', trackIds: ['picture'] }, { id: 'other', trackIds: ['audio', 'labels'] }],
	tracks: [{ id: 'picture', type: 'video', clipIds: ['v'] }, { id: 'audio', type: 'audio', clipIds: ['a'] },
		{ id: 'labels', type: 'label', labels: [{ id: 'cue', title: 'Other chapter', startFrame: 0, endFrame: 0 }] }],
	clips: [{ id: 'v', kind: 'video', timelineStartFrame: 0, durationFrames: 48_000 },
		{ id: 'a', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000 }],
};

function Output() {
	const [settings, setSettings] = useState({ mode: 'clips', format: 'mp3', chapterSource: 'labels', range: 'project' });
	const output = useExportDialogOutput({ project, copy: {}, hasSelection: false, hasLoop: false, settings, setSettings });
	return <select value={output.outputValue} onChange={() => undefined}>{output.outputOptions.map(option =>
		<option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>;
}

test('MI05 extension: export dialog split controls use the primary sequence material', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<Output />); });
		for (const name of ['clips', 'chapters']) {
			const option = dom.container.querySelectorAll('option').find(item => reactProps(item).value === name);
			assert.ok(option);
			assert.equal(reactProps(option).disabled, true);
		}
		const select = dom.container.querySelectorAll('select')[0];
		assert.ok(select);
		assert.equal(reactProps(select).value, 'project');
		assert.equal(exportDialogHasChapterLabels(project), false);
		assert.equal(exportDialogHasDeliveredChapterLabels(project, { format: 'mp3', mode: 'mix', range: 'project' }), false);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
