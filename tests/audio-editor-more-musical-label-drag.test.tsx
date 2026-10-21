/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand,
	redoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const control of ['label-box', 'left-ear', 'right-ear'] as const) {
	test(`MI20: dragging a musical label ${control} commits through native history and retains beat authority`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const document = dom.container.ownerDocument as unknown as Document;
		const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
		document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (!listener) return;
			const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
			entries.add(listener); listeners.set(type, entries);
		};
		document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) listeners.get(type)?.delete(listener); };
		const initial = createSoundscaperProject({ id: `musical-label-drag-${control}`, sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [
				{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
			] },
			tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'span', title: 'Across tempo change',
				anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } }] }],
			sequences: [{ id: 'main', trackIds: ['labels'] }], primarySequenceId: 'main' });
		let history = createSoundscaperProjectHistory(initial);
		const currentLabel = () => {
			const project = resolveRuntimeProjectProjection(history.present);
			const track = project.tracks.find(value => value.id === 'labels');
			assert.ok(track);
			const labels: unknown = Reflect.get(track, 'labels');
			assert.ok(Array.isArray(labels));
			const label: unknown = labels[0];
			assert.ok(isRecord(label) && typeof label.id === 'string' && typeof label.title === 'string'
				&& typeof label.startFrame === 'number' && typeof label.endFrame === 'number');
			return { id: label.id, title: label.title, startFrame: label.startFrame, endFrame: label.endFrame };
		};
		const label = currentLabel();
		const controller = { getSnapshot: () => ({ project: history.present }), actions: { labels: {
			update(trackId: string, labelId: string, changes: Record<string, unknown>) {
				history = executeSoundscaperProjectCommand(history, { type: 'label/update', trackId, labelId, changes });
			},
		}, timeline: { selectTrack() {}, setExactSelection() {} }, edit: {} } };
		const root = createRoot(dom.container as unknown as Element);
		const dispatch = (type: string, fields: Readonly<Record<string, number>>) => {
			const event = Object.assign(new Event(type), fields);
			for (const listener of [...listeners.get(type) ?? []]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		};
		try {
			await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels"
				label={label} left={162} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000}
				laneRef={{ current: { getBoundingClientRect: () => ({ left: 0 }) } }} selected editing={false} blocked={false} copy={ENGLISH_COPY}
				run={(operation: () => unknown) => operation()} onSelect={() => undefined}
				onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
			const marker = dom.one('[data-label-id]'), surface = dom.one(`.label-marker__${control}`);
			const downX = control === 'right-ear' ? 312 : 162;
			const mouse = { button: 0, clientX: downX, target: surface, currentTarget: marker, preventDefault() {}, stopPropagation() {} };
			await act(async () => {
				reactProps(marker).onMouseDownCapture(mouse); reactProps(surface).onMouseDown(mouse);
			});
			await act(async () => { dispatch('mousemove', { clientX: downX + 25 }); dispatch('mouseup', { button: 0 }); });
			const expected = control === 'label-box' ? [84_000, 156_000] : control === 'left-ear' ? [84_000, 144_000] : [72_000, 156_000];
			assert.deepEqual([currentLabel().startFrame, currentLabel().endFrame], expected);
			assert.equal(history.undoStack.length, 1);
			const track = history.present.tracks[0];
			assert.ok(track);
			const persisted: unknown = Reflect.get(track, 'labels');
			assert.ok(Array.isArray(persisted));
			const saved: unknown = persisted[0];
			assert.ok(isRecord(saved));
			assert.equal(saved.anchor, 'musical');
			assert.equal('startFrame' in saved || 'endFrame' in saved || 'coordinateDomain' in saved, false);
			assert.deepEqual(saved.startBeat, control === 'right-ear' ? { num: 3, den: 1 } : { num: 7, den: 2 });
			assert.deepEqual(saved.endBeat, control === 'left-ear' ? { num: 5, den: 1 } : { num: 21, den: 4 });
			history = undoSoundscaperProjectCommand(history);
			assert.deepEqual([currentLabel().startFrame, currentLabel().endFrame], [72_000, 144_000]);
			history = redoSoundscaperProjectCommand(history);
			assert.deepEqual([currentLabel().startFrame, currentLabel().endFrame], expected);
			history = executeSoundscaperProjectCommand(history, { type: 'label/update', trackId: 'labels', labelId: 'span', changes: { title: 'Edited label' } });
			assert.equal(currentLabel().title, 'Edited label');
			history = executeSoundscaperProjectCommand(history, { type: 'track/update', trackId: 'labels', changes: { name: 'Renamed musical labels' } });
			assert.deepEqual([currentLabel().startFrame, currentLabel().endFrame], expected);
		} finally {
			await act(async () => root.unmount());
			globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		}
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
