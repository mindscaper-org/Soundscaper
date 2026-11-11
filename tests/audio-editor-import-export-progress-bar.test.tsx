/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import EditorTaskProgress from '../src/common/editor/ui/workspace/EditorTaskProgress.tsx';
import type { TaskProgressBusySnapshot, TaskProgressViewModel } from '../src/common/editor/ui/task-progress-ui-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

(globalThis as unknown as { React: unknown }).React = React;

function renderProgress(snapshot: TaskProgressBusySnapshot, progress: TaskProgressViewModel | null) {
	return renderToStaticMarkup(<EditorTaskProgress
		controller={{
			subscribeTelemetry: () => () => undefined,
			getTelemetrySnapshot: () => ({ taskProgress: progress }),
			actions: { project: { cancelTask: () => true } },
		}}
		snapshot={snapshot}
		statusMessage="Reading audio"
		cancelLabel="Cancel"
	/>);
}

test('blocking imports and exports use a modal dialog independently of optional toolbars', () => {
	for (const kind of ['import', 'export'] as const) {
		const markup = renderProgress({ importing: kind === 'import', exporting: kind === 'export' }, {
			id: 'large-audio', kind, label: 'Reading audio', value: 0.375, cancellable: true,
		});
		assert.match(markup, /role="dialog"/u);
		assert.match(markup, /aria-modal="true"/u);
		assert.match(markup, /role="progressbar"/u);
		assert.match(markup, /aria-label="Reading audio"/u);
		assert.match(markup, /aria-valuenow="38"/u);
		assert.match(markup, /width:38%/u);
		assert.match(markup, />Cancel<\/button>/u);
		assert.doesNotMatch(markup, /data-editor-toast/u);
	}
});

test('non-blocking tasks use persistent progress toasts for known and unknown amounts', () => {
	for (const value of [null, 0, 0.375, 1]) {
		const markup = renderProgress({}, { id: 'save', kind: 'project-io', label: 'Saving project', value });
		assert.match(markup, /data-editor-toast="task-progress-save"/u);
		assert.match(markup, /role="progressbar"/u);
		assert.doesNotMatch(markup, /role="dialog"|data-timed|toast-close/u);
		if (value === null) {
			assert.match(markup, /data-indeterminate=""/u);
			assert.doesNotMatch(markup, /aria-valuenow/u);
		} else {
			assert.match(markup, new RegExp(`aria-valuenow="${Math.round(value * 100)}"`, 'u'));
		}
	}
});

test('preflight uses indeterminate progress and completion removes the entire surface', () => {
	const markup = renderProgress({ importing: true }, null);
	assert.match(markup, /role="dialog"/u);
	assert.match(markup, /data-indeterminate=""/u);
	assert.doesNotMatch(markup, /aria-valuenow|>Cancel</u);
	assert.equal(renderProgress({}, null), '');
});

test('the selection and status toolbars no longer contain task progress', () => {
	for (const showSelectionToolbar of [false, true]) {
		const markup = renderToStaticMarkup(<AccessibleSelectionToolbar
			controller={{}}
			snapshot={{ selection: null, importing: true }}
			copy={ENGLISH_COPY}
			statusMessage="Reading audio"
			statusState="info"
			durationFrames={0}
			disabled={true}
			showSelectionToolbar={showSelectionToolbar}
			showStatusbar={true}
			run={() => undefined}
		/>);
		assert.doesNotMatch(markup, /progressbar|task-progress/u);
	}
});
