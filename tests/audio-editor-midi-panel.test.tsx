/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { MidiInstrumentSelect } from '../src/common/editor/ui/workspace/MidiInstrumentSelect.tsx';
import { bindNativePluginPresetBridge } from '../src/common/editor/controller/effects/native-plugin-preset-runtime.ts';
import type { SoundscaperNativePluginHostBridgeV1 } from '../src/common/editor/native-plugin-host-contract.ts';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';

const telemetry = { positionFrame: 0 };
const noop = () => undefined;
const controller = {
	subscribeTelemetry: () => noop,
	getTelemetrySnapshot: () => telemetry,
	actions: { midi: {
		addNote: noop, updateNote: noop, updateNotes: noop, deleteNotes: noop,
		resizeClip: noop, setInstrument: noop, previewNote: noop,
	} },
};

test('piano roll exposes a keyboard-accessible note editor and audition controls beside the design-system grid', () => {
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes',
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }, { version: 1, notes: [
		{ id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 12_000 },
	] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', height: 114, collapsed: false, locked: false, clipIds: ['clip'] }, { version: 1, instrument: 'triangle' });
	const project = { id: 'project', sampleRate: 48_000, clips: [clip], tracks: [track] } as unknown as EditorProject;
	const markup = renderToStaticMarkup(<PianoRollWorkspacePanel controller={controller}
		snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />);
	assert.match(markup, /role="group" aria-label="Note editor"/u);
	for (const label of ['Pitch (MIDI number)', 'Note start (seconds)', 'Note duration (seconds)', 'Velocity', 'MIDI channel']) {
		assert.ok(markup.includes(label), label);
	}
	assert.match(markup, /<option value="triangle" selected="">Triangle<\/option>/u);
	assert.match(markup, /Computer keyboard/u);
	assert.match(markup, /<option value="note">60/u);
	assert.match(markup, /<canvas/u);
});

test('piano roll explains how to choose a MIDI clip without adding controls to an audio selection', () => {
	const project = { id: 'project', sampleRate: 48_000, clips: [], tracks: [] } as unknown as EditorProject;
	const markup = renderToStaticMarkup(<PianoRollWorkspacePanel controller={controller}
		snapshot={{ project, selectedTrackId: null, selectedClipId: null }} copy={{}} blocked={false} run={operation => operation()} />);
	assert.match(markup, /Select a MIDI track or clip to edit\./u);
	assert.doesNotMatch(markup, /<button|<input|<select/u);
});

for (const action of ['commit on the same track', 'select another track', 'choose another instrument'] as const) {
	test(`a pending native instrument selection follows the current request when users ${action}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; soundscaperDesktop?: unknown };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousDesktop = actGlobal.soundscaperDesktop;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		actGlobal.soundscaperDesktop = { v1: new Proxy({
			listNativePlugins: async () => ({ entries: [{ classification: 'instrument', format: 'vst3',
				name: 'Native synth', eligible: true, installations: [{ installationId: 'native-synth', allowed: true }] }] }),
		}, { get: (target, method) => Reflect.get(target, method) ?? noop }) };
		const preflight = deferred<void>();
		const instantiated: string[] = [];
		const builtIns: string[] = [];
		const pending: Promise<unknown>[] = [];
		let selectedTrackId = 'first';
		let preflightCount = 0;
		const owner = { getSnapshot: () => ({ selectedTrackId }) };
		const detach = bindNativePluginPresetBridge(owner, {
			selectNativePluginInstallation: () => { preflightCount += 1; return preflight.promise; },
			instantiateNativePlugin: async () => { instantiated.push(selectedTrackId); return { instanceId: 'instance' }; },
			closeNativePluginInstance: async () => true,
		} as unknown as SoundscaperNativePluginHostBridgeV1);
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			const track = withMidiTrackData({ type: 'audio', id: 'first', clipIds: ['clip'] }, { version: 1, instrument: 'triangle' });
			await act(async () => root.render(<MidiInstrumentSelect controller={owner} track={track} instrument="triangle"
				sampleRate={48_000} disabled={false} copy={{ instrument: 'Instrument', triangle: 'Triangle', sine: 'Sine' }}
				setInstrument={instrument => { if (typeof instrument === 'string') builtIns.push(instrument); }}
				run={operation => pending.push(Promise.resolve(operation()))} />));
			const selector = dom.one('select');
			assert.ok(selector.querySelector('[value="native:native-synth"]'));
			await act(async () => reactProps(selector).onChange?.({ currentTarget: { value: 'native:native-synth' } }));
			assert.equal(preflightCount, 1);
			if (action === 'select another track') selectedTrackId = 'second';
			if (action === 'choose another instrument') await act(async () => reactProps(selector).onChange?.({ currentTarget: { value: 'sine' } }));
			await act(async () => { preflight.resolve(); await Promise.all(pending); });
			assert.deepEqual(instantiated, action === 'commit on the same track' ? ['first'] : []);
			assert.deepEqual(builtIns, action === 'choose another instrument' ? ['sine'] : []);
		} finally {
			await act(async () => { preflight.resolve(); await Promise.allSettled(pending); root.unmount(); });
			detach();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			actGlobal.soundscaperDesktop = previousDesktop;
			dom.restore();
		}
	});
}
