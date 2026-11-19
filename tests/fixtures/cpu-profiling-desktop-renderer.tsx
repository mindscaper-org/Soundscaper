/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CpuProfilingPanel from '../../src/common/editor/ui/dialogs/CpuProfilingPanel.tsx';
import AudioEditorMenuBar from '../../src/common/editor/ui/AudioEditorMenuBar.jsx';
import createApplicationMenus from '../../src/common/editor/ui/application-menus.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { applyEffectRack } from '../../src/common/editor/engine/effect-rack.ts';
import { ensureCpuProfileWorklet } from '../../src/common/editor/engine/cpu-profile-instrumentation.ts';
import type { CpuProfilerBridge } from '../../src/common/editor/cpu-profile-contract.ts';
import { createMenuActionFixture } from '../helpers/application-menu-fixture.ts';
import { createAudioEditorPreferencesV1 } from '../../src/common/editor/preferences.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';

const bridge = (globalThis as typeof globalThis & { cpuProfiler: CpuProfilerBridge }).cpuProfiler;
const project = { ...createSoundscaperProject(), tracks: [{ id: 'a', type: 'audio', name: 'Voice',
	effects: [{ id: 'filter-a', type: 'lowpass' }, { id: 'filter-b', type: 'lowpass' },
		{ id: 'off', type: 'lowpass', bypassed: true }] }] };
let context: AudioContext | undefined;

async function play(): Promise<void> {
	await context?.close();
	context = new AudioContext();
	await ensureCpuProfileWorklet(context);
	const source = context.createOscillator();
	const nodes: AudioNode[] = [];
	const output = applyEffectRack(context, source, project.tracks[0]!.effects, nodes, { scope: 'track', targetId: 'a' });
	const mute = context.createGain(); mute.gain.value = 0;
	output.connect(mute); mute.connect(context.destination);
	source.start(); await context.resume();
}

function Harness() {
	const [open, setOpen] = useState(false);
	const [failure, setFailure] = useState('');
	const menus = createApplicationMenus({ productId: 'soundscaper', aboutLabel: 'About', copy: ENGLISH_COPY,
		locale: 'en', capabilities: {}, project, snapshot: { project, preferences: createAudioEditorPreferencesV1(), effects: {}, history: {} },
		blocked: false, editBlocked: false, showArmControls: false, selectionActive: false, selectedClip: null,
		durationFrames: 0, effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		actions: createMenuActionFixture({ openCpuProfiling: () => setOpen(true) }),
	});
	return <div id="kw-audio-editor-design-system">
		<AudioEditorMenuBar menus={menus} copy={ENGLISH_COPY} locale="en" appName="Soundscaper"
			onAssistanceSearchClose={() => {}} onFullscreen={() => {}} onSearchActivate={() => {}}
			projectTabs={null} projectName="Profiler" saveState="saved" saveText="Saved" />
		<button onClick={() => { void play().catch(error => setFailure(String(error))); }}>Start audio</button>
		{failure && <p role="alert">{failure}</p>}
		{open && <CpuProfilingPanel bridge={bridge} project={project} copy={ENGLISH_COPY} locale="en" onClose={() => setOpen(false)} />}
	</div>;
}
createRoot(document.body).render(<Harness />);
