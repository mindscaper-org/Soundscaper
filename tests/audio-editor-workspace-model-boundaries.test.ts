/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('the workspace producer passes one overlay model and View reuses one dock runtime', async () => {
	const [workspace, view] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspace.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx', import.meta.url), 'utf8'),
	]);
	assert.match(workspace, /const overlayModel = createWorkspaceOverlayModel\(\{/u);
	assert.match(workspace, /<AudioEditorWorkspaceView model=\{\{[\s\S]*\boverlayModel,/u);
	assert.match(view, /<AudioEditorWorkspaceOverlays model=\{overlayModel\}/u);
	assert.equal(view.match(/<WorkspacePanelDock \{\.\.\.panelDockRuntime\} dock=/gu)?.length, 5);
	assert.match(view, /dock="left" aboutLabel=\{overlayModel\.aboutLabel\}/u);
});
