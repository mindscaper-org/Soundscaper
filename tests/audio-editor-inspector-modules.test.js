import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FEATURE_MODULES = Object.freeze([
	'RealtimeAnalysisPanel.jsx',
	'AudioEditorEffectsOverlay.jsx',
	'AudioEditorMacroManagerDialog.jsx',
	'ClipPropertiesPanel.tsx',
	'ClipSourceMonitorPanel.tsx',
	'ExportDialog.jsx',
	'LabelExportDialog.jsx',
	'SelectionEffectsDialog.jsx',
]);

test('Inspector features have direct lazy entry points', async () => {
	const app = await readFile(new URL('../src/common/editor/ui/AudioEditorApp.jsx', import.meta.url), 'utf8');
	const panelOwner = await readFile(new URL('../src/common/editor/ui/workspace/WorkspacePanelContent.jsx', import.meta.url), 'utf8');
	const overlayOwner = await readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8');
	const lazyOwners = `${app}\n${panelOwner}\n${overlayOwner}`;
	assert.doesNotMatch(lazyOwners, /loadAudioEditorInspector|import\('\.\.\/AudioEditorInspector\.jsx'\)/);

	for (const moduleName of FEATURE_MODULES) {
		assert.match(lazyOwners, new RegExp(`inspector/${moduleName.replaceAll('.', '\\.')}`), moduleName);
		const source = await readFile(new URL(`../src/common/editor/ui/inspector/${moduleName}`, import.meta.url), 'utf8');
		assert.match(source, /export default /, `${moduleName} must expose a direct lazy default export`);
	}
});
