/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const control of ['label-box', 'left-ear', 'right-ear', 'left-stalk', 'point-stalk'] as const) {
	for (const pointerType of ['touch', 'pen']) test(`MI29: imported caption ${control} accepts an owning ${pointerType} drag`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
		const document = dom.container.ownerDocument as unknown as Document;
		document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (!listener) return;
			const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
			entries.add(listener); listeners.set(type, entries);
		};
		document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) listeners.get(type)?.delete(listener); };
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `label-pointer-${control}-${pointerType}` }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); });
		const root = createRoot(dom.container as unknown as Element);
		const dispatch = (type: string, fields: Readonly<Record<string, unknown>>) => {
			const event = new Event(type);
			for (const [key, value] of Object.entries(fields)) Reflect.defineProperty(event, key, { value });
			for (const listener of [...listeners.get(type) ?? []]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		};
		try {
			await controller.ready;
			const file = control === 'point-stalk' ? new File(['1\t1\tPoint\n'], 'Points.txt')
				: new File(['1\n00:00:01,000 --> 00:00:02,000\nCaption\n'], 'Caption.srt');
			const imported = await controller.actions.labels.importFile(file);
			assert.ok(imported);
			const label = imported.labels[0]; assert.ok(label);
			const initial = [label.startFrame, label.endFrame];
			await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId={imported.trackId}
				label={label} left={112} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000}
				laneRef={{ current: { getBoundingClientRect: () => ({ left: 0 }) } }} selected editing={false} blocked={false} copy={COPY}
				run={(operation: () => unknown) => operation()} onSelect={() => undefined} onEdit={() => undefined}
				onFinishEdit={() => undefined} onRemove={() => undefined} />));
			const marker = dom.one('[data-label-id]'), surface = dom.one(`.label-marker__${control === 'point-stalk' ? 'left-stalk' : control}`);
			const downX = control === 'right-ear' ? 212 : control === 'point-stalk' ? 112.5 : 112;
			const captures: number[] = [];
			Reflect.defineProperty(marker, 'setPointerCapture', { value: (id: number) => captures.push(id) });
			const pointer = (clientX: number, pointerId = 1) => ({ button: 0, pointerType, pointerId,
				isPrimary: pointerId === 1, clientX, target: surface, currentTarget: surface, preventDefault() {}, stopPropagation() {} });
			const down = async (pointerId = 1) => act(async () => {
				reactProps(marker).onPointerDownCapture?.(pointer(downX, pointerId));
				reactProps(surface).onPointerDown?.(pointer(downX, pointerId));
			});
			await down();
			await act(async () => { dispatch('pointermove', pointer(downX + 25)); });
			await down(2);
			await act(async () => { dispatch('pointermove', pointer(downX + 75, 2)); dispatch('pointerup', pointer(downX + 75, 2)); });
			await act(async () => { dispatch('pointerup', pointer(downX + 25)); });
			const expected = control === 'point-stalk' ? [60_000, 60_000] : control === 'label-box' ? [60_000, 108_000]
				: control === 'right-ear' ? [48_000, 108_000] : [60_000, 96_000];
			const current = controller.project?.tracks.find(track => track.id === imported.trackId); assert.ok(current);
			const labels: unknown = Reflect.get(current, 'labels'); assert.ok(Array.isArray(labels));
			const saved: unknown = labels[0]; assert.ok(isRecord(saved));
			assert.deepEqual([saved.startFrame, saved.endFrame], expected);
			assert.deepEqual(captures, [1]);
			controller.actions.edit.undo();
			const undone = controller.project?.tracks.find(track => track.id === imported.trackId); assert.ok(undone);
			const undoneLabels: unknown = Reflect.get(undone, 'labels'); assert.ok(Array.isArray(undoneLabels));
			const restored: unknown = undoneLabels[0]; assert.ok(isRecord(restored));
			assert.deepEqual([restored.startFrame, restored.endFrame], initial);
			await down();
			await act(async () => {
				dispatch('pointermove', pointer(downX + 25));
				dispatch('pointercancel', pointer(downX + 25));
				dispatch('pointerup', pointer(downX + 25));
			});
			const cancelled = controller.project?.tracks.find(track => track.id === imported.trackId); assert.ok(cancelled);
			const cancelledLabels: unknown = Reflect.get(cancelled, 'labels'); assert.ok(Array.isArray(cancelledLabels));
			const unchanged: unknown = cancelledLabels[0]; assert.ok(isRecord(unchanged));
			assert.deepEqual([unchanged.startFrame, unchanged.endFrame], initial, 'cancelled pointers cannot publish their draft');
		} finally {
			await act(async () => root.unmount()); dom.restore(); globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		}
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
