/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { CustomToolbarButtonSettings } from '../src/common/editor/ui/toolbar/CustomToolbarButtons.tsx';
import ProjectBinRemoveDialog from '../src/common/editor/ui/workspace/ProjectBinRemoveDialog.tsx';
import { TrackFolderRow } from '../src/common/editor/ui/timeline/TrackFolderRow.jsx';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { planTrackListRows } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { rackEffectLabel, formatAup4CompatibilityItem } from '../src/common/editor/ui/dialogs/editor-dialog-model.js';
import { createMissingEffect } from '../src/common/editor/effects.js';
import AudiocomProjectArchives from '../src/common/editor/ui/workspace/AudiocomProjectArchives.tsx';
import { AUDIOCOM_COPY_BY_LOCALE } from '../src/common/i18n/audiocom-copy.ts';
import { createAudiocomProjectArchives } from '../src/common/editor/controller/import/audiocom-project-archives.ts';
import SoundscaperRoutingGraphView from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';

Object.assign(globalThis, { React });

const noop = () => undefined;
const name = 'Mix $& $$ {level} {count} {inputs}';
const escaped = name.replaceAll('&', '&amp;');

test('custom-toolbar edit labels preserve authored dollar and brace tokens', () => {
	const html = renderToStaticMarkup(<CustomToolbarButtonSettings buttons={[{ id: 'mine', name, actionId: 'copy', icon: 'PLUS' }]} toolbarButtons={{}} copy={ENGLISH_COPY} onCustomize={noop} onToggle={noop} />);
	assert.ok(html.includes(`aria-label="Edit ${escaped}"`));
	assert.ok(html.includes(`title="Edit ${escaped}"`));
});

test('folder identity and destructive project-bin confirmation insert each value once', () => {
	const project = createSoundscaperProject({ id: 'literal-folder', primarySequenceId: 'main', trackFolders: [{ id: 'folder', name }], tracks: [createAudioTrack({ id: 'track' })], sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'folder', parentFolderId: null }, { kind: 'track', id: 'track', parentFolderId: 'folder' }] }] });
	const plan = planTrackListRows(createDocumentTrackFolderSnapshot(project), project.tracks, project.trackFolders);
	const folder = renderToStaticMarkup(<TrackFolderRow row={plan.folderRows[0]} plan={plan} copy={ENGLISH_COPY} blocked={false} selected={true} activeFolderId="folder" panelWidth={240} editing={false} onSelect={noop} onKeyDown={noop} onToggleCollapsed={noop} onSetFlag={noop} onMenu={noop} onRename={noop} onDropNode={noop} />);
	assert.ok(folder.includes(`aria-label="Folder ${escaped}, level 1"`));
	const prompt = renderToStaticMarkup(<ProjectBinRemoveDialog name={name} count={4} copy={{ ...ENGLISH_COPY, projectBinRemoveConfirm: 'Remove {name} with {count} instances?' }} disabled={false} onCancel={noop} onConfirm={noop} />);
	assert.ok(prompt.includes(`Remove ${escaped} with 4 instances?`));
});

test('missing effects retain their external names in both compatibility and mixer labels', () => {
	const effect = createMissingEffect({ id: 'missing', enabled: true, missing: { name, nativeId: 'Effect_VST3_Acme_Reverb_/plugins/reverb.vst3', reason: 'plugin-unavailable', source: 'aup4' } });
	assert.equal(rackEffectLabel(effect, new Map(), ENGLISH_COPY), `Missing: ${name}`);
	assert.equal(formatAup4CompatibilityItem({ disposition: 'missing', data: effect.missing }, ENGLISH_COPY), `Missing: ${name}`);
});

test('routing node and port labels preserve authored tokens without consuming later placeholders', () => {
	const project = createSoundscaperProject({ id: 'literal-routing', tracks: [createAudioTrack({ id: 'track', name })] });
	const html = renderToStaticMarkup(<SoundscaperRoutingGraphView project={project} graph={project.mixer} disabled={false} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY} dismissLabel="Close" onCommit={noop} />);
	assert.ok(html.includes(`aria-label="Track ${escaped}, 2 Channels, 0 inputs, 1 outputs"`));
	assert.ok(html.includes(`aria-label="Start connection from ${escaped}"`));
});

test('completed cloud saves retain the real archive filename', async () => {
	const archive = { id: 'archive', name, format: 'aup3', size: 16, snapshotId: null };
	const archives = createAudiocomProjectArchives({ client: { capabilities: async () => ({ formats: ['aup3'], maximumBytes: 100000000 }), list: async () => ({ results: [archive], page: 1, hasNext: false }), upload: async () => archive }, revisionStorage: null });
	try {
		await archives.setConnected(true);
		await archives.saveProject('literal-cloud', async () => new File(['SQLite format 3\0'], `${name}.aup3`));
		const html = renderToStaticMarkup(<AudiocomProjectArchives copy={AUDIOCOM_COPY_BY_LOCALE.en} state={archives.getSnapshot()} onRefresh={noop} onCancel={noop} />);
		assert.ok(html.includes(`Stored ${escaped}.aup3.`));
	} finally { archives.dispose(); }
});

test('macro review preserves imported provenance before consent', () => {
	const html = renderToStaticMarkup(<MacroScriptEditor copy={{ reviewOrigin: 'Imported from {origin}' }} script={{ id: 'program', name: 'Review me', source: '', trust: 'unreviewed', origin: `${name}.soundscapemacro` }} log={[]} failure={null} running={false} blocked={false} runnable={false} onChange={noop} onRun={noop} onCancel={noop} onTrust={noop} />);
	assert.ok(html.includes(`Imported from ${escaped}.soundscapemacro`));
});
