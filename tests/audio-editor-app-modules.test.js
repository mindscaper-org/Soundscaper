import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const UI_ROOT = new URL('../src/common/editor/ui/', import.meta.url);
const LAZY_DIALOGS = Object.freeze([
	'EditorDialog.jsx',
	'GeneratorDialog.jsx',
	'NyquistDialog.jsx',
	'SpectralSelectionDialog.jsx',
	'WorkspacePreferencesDialog.jsx',
]);

test('heavy workspace dialogs retain direct lazy entry points', async () => {
	const overlayOwner = await readFile(new URL('workspace/AudioEditorWorkspaceOverlays.jsx', UI_ROOT), 'utf8');
	for (const moduleName of LAZY_DIALOGS) {
		assert.match(
			overlayOwner,
			new RegExp(`import\\('\\.\\./dialogs/${moduleName.replaceAll('.', '\\.')}'\\)`),
			moduleName,
		);
		const source = await readFile(new URL(`dialogs/${moduleName}`, UI_ROOT), 'utf8');
		assert.match(source, /export default /, `${moduleName} must expose a lazy default export`);
	}
});

test('browser preferences do not retain the legacy FFmpeg offline runtime', async () => {
	const preferences = await readFile(new URL('dialogs/WorkspacePreferencesDialog.jsx', UI_ROOT), 'utf8');
	assert.doesNotMatch(preferences, /OfflineRuntimePreferencePanel/u);
	assert.doesNotMatch(preferences, /id: ['"]offline['"]/u);
	assert.doesNotMatch(preferences, /selectedPage === ['"]offline['"]/u);
});

test('desktop read callers retain capabilities for their scoped consumers', async () => {
	const workspace = await readFile(new URL('workspace/AudioEditorWorkspace.jsx', UI_ROOT), 'utf8');
	const projectBin = await readFile(new URL('workspace/ProjectBinPanel.jsx', UI_ROOT), 'utf8');
	const desktopBridge = await readFile(new URL('workspace/useDesktopEditorBridge.js', UI_ROOT), 'utf8');
	const fileChoice = await readFile(new URL('workspace/desktop-workspace-file-choice.ts', UI_ROOT), 'utf8');
	assert.match(workspace, /withDesktopProjectReadDescriptor\(/u);
	for (const source of [workspace, projectBin]) {
		assert.match(source, /import \{ openDesktopWorkspaceFiles \} from '\.\/desktop-workspace-file-choice\.ts'/u);
		assert.match(source, /openDesktopWorkspaceFiles\(\{/u);
	}
	assert.match(fileChoice, /runtime\.fileService\.withReadDescriptors\(descriptors, \{\}, async files =>/u);
	assert.match(desktopBridge, /openDesktopProjectDescriptor\(descriptor\)/u);
	for (const source of [workspace, projectBin, desktopBridge, fileChoice]) {
		assert.doesNotMatch(source, /fileService\.openReadDescriptor\(/u);
	}
});
