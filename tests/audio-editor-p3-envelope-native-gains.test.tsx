/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useAudioTrackEnvelope } from '../src/common/editor/ui/timeline/useAudioTrackEnvelope.js';
import { envelopeValueToDb } from '../src/common/editor/automation.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const gain of [4, 16]) test(`editing another clip point retains authored envelope gain ${gain}`, async () => {
	const f = await fixture(gain);
	try {
		await f.edit([{ time: 0, db: envelopeValueToDb(gain) }, { time: .5, db: -6 }]);
		assert.equal(f.publications.length, 1);
		assert.ok(Math.abs(Number(f.publications[0]?.envelope[0]?.value) - gain) < 1e-12);
		assert.ok(Math.abs(Number(f.publications[0]?.envelope[1]?.value) - 10 ** (-6 / 20)) < 1e-12);
	} finally { await f.cleanup(); }
});

test('a supported twelve dB clip envelope drag retains its full authored gain', async () => {
	const f = await fixture(1);
	try {
		await f.edit([{ time: 0, db: 12 }, { time: .5, db: 0 }]);
		assert.ok(Math.abs(Number(f.publications[0]?.envelope[0]?.value) - 10 ** (12 / 20)) < 1e-12);
	} finally { await f.cleanup(); }
});

test('clip envelope publication still refuses gains above the native maximum', async () => {
	const f = await fixture(1);
	try {
		await f.edit([{ time: 0, db: 100 }, { time: .5, db: 0 }]);
		assert.ok(Number(f.publications[0]?.envelope[0]?.value) <= 16);
	} finally { await f.cleanup(); }
});

async function fixture(gain: number) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (listener) { const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>(); entries.add(listener); listeners.set(type, entries); }
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (listener) listeners.get(type)?.delete(listener);
	};
	type Envelope = readonly Readonly<{ frame: number; value: number }>[];
	const publications: { envelope: Envelope }[] = [];
	const clip = { id: 'clip', durationFrames: 48_000, envelope: [{ frame: 0, value: gain }, { frame: 24_000, value: 1 }] };
	const hook = { current: null as ReturnType<typeof useAudioTrackEnvelope> | null };
	function Probe() {
		hook.current = useAudioTrackEnvelope({
			controller: { actions: { clip: { update: (_id: string, changes: { envelope: Envelope }) => { publications.push(changes); } } } },
			run: (operation: () => unknown) => operation(), blocked: false, automationToolEnabled: true,
			clipLookup: new Map([['clip', clip]]), projectionClips: [{ id: 'clip', waveformStartFrame: 0, waveformEndFrame: 48_000 }], sampleRate: 48_000,
		});
		return <div />;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<Probe />));
	return {
		publications,
		edit: async (points: readonly Readonly<{ time: number; db: number }>[]) => {
			assert.ok(hook.current);
			await act(async () => { hook.current?.updateEnvelope('clip', points); });
			await act(async () => {
				const event = { button: 0 } as MouseEvent;
				for (const listener of [...listeners.get('mouseup') ?? []]) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
				await new Promise<void>(resolve => setTimeout(resolve, 5));
			});
		},
		cleanup: async () => { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); },
	};
}
