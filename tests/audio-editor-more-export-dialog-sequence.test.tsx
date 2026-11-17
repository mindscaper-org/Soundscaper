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

function Output({ mode = 'clips', sequences }: Readonly<{
	mode?: string; sequences?: readonly Readonly<{ id: string; name: string; deliverable: boolean }>[];
}>) {
	const [settings, setSettings] = useState({ mode, format: 'mp3', chapterSource: 'labels', range: 'project' });
	const output = useExportDialogOutput({ project, copy: {}, hasSelection: false, hasLoop: false, settings, setSettings, ...(sequences ? { sequences } : {}) });
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
			const option = dom.container.querySelectorAll('option').find(item => {
				const value: unknown = reactProps(item).value;
				return value === name;
			});
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

test('the audio export output menu keeps a valid mastering sequence available when stems are selected', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<Output mode="stems" sequences={[{ id: 'album', name: 'Album', deliverable: true }]} />); });
		const slot = dom.container.querySelectorAll('option').find(item => {
			const value: unknown = reactProps(item).value;
			return value === 'mastering-sequence:album';
		});
		assert.ok(slot, 'the user can switch directly from stems to the album order');
		assert.equal(reactProps(slot).disabled, false);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
