/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useSpreadsheetRows } from '../src/common/editor/ui/clip-spreadsheet/row-presentation.ts';
import { getClipSpreadsheetRows } from '../src/common/editor/clip-spreadsheet.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { useTrackAutomationControls } from '../src/common/editor/ui/timeline/useTrackAutomationControls.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('editing one spreadsheet cell retains every unchanged row presentation', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const source = createAudioSource({ id: 's', sampleRate: 48000, frameCount: 48000, channelCount: 1 });
	const clips = Array.from({ length: 20 }, (_, i) => createAudioClip({ id: `clip-${i}`, title: `Take ${i}`, sourceId: source.id, durationFrames: 100, timelineStartFrame: i * 100 }));
	const project = createSoundscaperProject({ id: 'spreadsheet-identity', sources: [source], clips, tracks: [createAudioTrack({ id: 'voice', clipIds: clips.map(clip => clip.id) })] });
	const labels = { selectRow: 'Select row {row}' };
	let presentations: ReturnType<typeof useSpreadsheetRows> = [];
	function View({ value }: { value: unknown }) { presentations = useSpreadsheetRows(getClipSpreadsheetRows(value), labels); return null; }
	try {
		await act(async () => root.render(<View value={project} />));
		const before = presentations;
		await act(async () => root.render(<View value={{ ...project, clips: project.clips.map((clip, i) => i === 3 ? { ...clip, title: 'Changed' } : clip) }} />));
		assert.notEqual(presentations[3], before[3]);
		for (let i = 0; i < presentations.length; i++) if (i !== 3) assert.equal(presentations[i], before[i]);
		assert.equal(presentations[3]?.row.cells.name, 'Changed');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('hidden automation controls build no target inventory until one track opts in', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const project = createSoundscaperProject({ id: 'hidden-automation', tracks: Array.from({ length: 100 }, (_, i) => createAudioTrack({ id: `track-${i}` })) });
	let model: ReturnType<typeof useTrackAutomationControls> | undefined;
	function View() { model = useTrackAutomationControls(project, true); return null; }
	try {
		await act(async () => root.render(<View />));
		assert.equal(model?.targetsByTrackId.size, 0);
		await act(async () => model?.toggle('track-42'));
		assert.equal(model?.targetsByTrackId.size, 1);
		assert.equal(model?.isVisible('track-42'), true);
		assert.ok(model?.selectedTargetByTrackId.get('track-42'));
		await act(async () => model?.toggle('track-42'));
		assert.equal(model?.targetsByTrackId.size, 0);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('source ruler signature preparation is linear and survives playhead-only updates', async () => {
	const { default: Ruler, INITIAL_SOURCE_RULER_OPTIONS } = await import('../src/common/editor/ui/inspector/ClipSourceRuler.tsx');
	const { ENGLISH_COPY } = await import('../src/common/i18n/catalogs.js');
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let barReads = 0;
	const signatureMap = { events: Array.from({ length: 100 }, (_, i) => ({ get bar() { barReads++; return i * 4; }, numerator: i % 2 ? 3 : 4, denominator: 4 })) };
	const noop = () => undefined;
	const props: React.ComponentProps<typeof Ruler> = { copy: ENGLISH_COPY, width: 600, startFrame: 0, endFrame: 480000, clipStartFrame: 0, projectStartFrame: 0, sampleRate: 48000, tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] }, signatureMap, options: { ...INITIAL_SOURCE_RULER_OPTIONS, beats: true }, playing: true, positionFrame: 0, onSeekFrame: noop, loop: false, loopRange: null, selection: null, disabled: false, onOptions: noop, onPlay: noop, onStop: noop, onLoop: noop, onClearLoop: noop, onLoopSelection: noop, onSelectionLoop: noop, onSeek: noop };
	try {
		await act(async () => root.render(<Ruler {...props} />));
		assert.ok(barReads < 100 * 15, `${barReads} signature reads`);
		const initial = barReads;
		for (let tick = 1; tick <= 5; tick++) await act(async () => root.render(<Ruler {...props} positionFrame={tick * 1000} />));
		assert.equal(barReads, initial);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
