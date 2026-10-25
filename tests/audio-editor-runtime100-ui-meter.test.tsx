/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runGcRegressionInChild } from './helpers/exposed-gc-regression.ts';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { sameTrackMeterDisplay } from '../src/common/editor/ui/timeline/TrackTelemetryMeters.tsx';
import { MixerTelemetryMeters } from '../src/common/editor/ui/workspace/MixerTelemetryMeters.tsx';
import { productionStripMeter, meterChannelReadings, type ChannelMeterSource } from '../src/common/editor/ui/meter-channel-readings.ts';
import type { StripMeterSnapshot } from '../src/common/editor/production-audio/strip-meter-session.ts';

function meter(id: string, peak = 0.5): StripMeterSnapshot {
	return Object.freeze({ strip: Object.freeze({ kind: 'track' as const, id }), sequence: 1, channelCount: 2, channels: Object.freeze([Object.freeze({ label: 'L', peak, rms: 0 }), Object.freeze({ label: 'R', peak, rms: 0 })]), correlation: null, phaseDegrees: null });
}
void test('U31 unchanged strip-meter display equality avoids repeated dB projection', t => {
	let logs = 0; const original = Math.log10; Math.log10 = value => { logs++; return original(value); };
	try { for (let i = 0; i < 100; i++) assert.equal(sameTrackMeterDisplay(meter('t'), meter('t')), true); } finally { Math.log10 = original; }
	t.diagnostic(`unchanged display logarithms ${logs}`); assert.equal(logs, 0);
	const values: ChannelMeterSource[] = [undefined, { dbfs: -80, peak: 0 }, { dbfs: -Infinity }, { dbfs: Number.NaN, peak: 1 }, { dbfs: 0 }, { dbfs: 100 }, meter('t', 0), meter('t', -1), meter('t', Number.NaN), meter('t', 0.5), meter('t', 1), meter('t', 2)];
	for (const left of values) for (const right of values) { const a = meterChannelReadings(left), b = meterChannelReadings(right); assert.equal(sameTrackMeterDisplay(left, right), a.every((reading, i) => reading.level === b[i]?.level && reading.clipped === b[i]?.clipped)); }
});
void test('U32 mixer selectors suppress fresh meter publications whose displayed bars are unchanged', async t => {
	const dom = installReactTestDom(); const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const prior = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<() => void>(); let telemetry = { meters: { productionMeters: [meter('t')] } };
	const controller = { getTelemetrySnapshot: () => telemetry, subscribeTelemetry(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } };
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	let logs = 0; const original = Math.log10;
	try {
		await act(async () => root.render(<MixerTelemetryMeters controller={controller} scope="track" targetId="t" />));
		Math.log10 = value => { logs++; return original(value); };
		for (let i = 0; i < 20; i++) await act(async () => { telemetry = { meters: { productionMeters: [meter('t')] } }; for (const listener of listeners) listener(); });
		t.diagnostic(`unchanged mixer display logarithms ${logs}`); assert.equal(logs, 0);
		await act(async () => { telemetry = { meters: { productionMeters: [meter('t', 1)] } }; for (const listener of listeners) listener(); });
		assert.ok(logs > 0); assert.equal(dom.container.querySelectorAll('.mixer-channel__meter-clip--active').length, 2);
	} finally { Math.log10 = original; await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore(); }
});
void test('U33 production strip selectors index one bounded frozen meter publication', t => {
	let reads = 0, preparation = 0;
	const values = Object.freeze(Array.from({ length: 100 }, (_, i) => meter(`t${i}`)));
	const meters = new Proxy(values, { get(target, key, receiver) { if (/^\d+$/u.test(String(key))) reads++; return Reflect.get(target, key, receiver) as unknown; }, getOwnPropertyDescriptor(target, key) { if (/^\d+$/u.test(String(key))) preparation++; return Reflect.getOwnPropertyDescriptor(target, key); } });
	for (let i = 0; i < 100; i++) assert.equal(productionStripMeter(meters, 'track', `t${i}`), values[i]);
	t.diagnostic(`meter indexed reads ${reads}; admission descriptors ${preparation}`); assert.equal(reads, 0); assert.ok(preparation <= 300);
	const mutable = [meter('before')]; assert.ok(productionStripMeter(mutable, 'track', 'before')); mutable[0] = meter('after'); assert.equal(productionStripMeter(mutable, 'track', 'before'), undefined); assert.ok(productionStripMeter(mutable, 'track', 'after'));
	assert.equal(productionStripMeter(Object.freeze([meter('same', 0.2), meter('same', 0.8)]), 'track', 'same')?.channels[0]?.peak, 0.2);
});
void test('production meter lookup releases replaced and weakly owned publication records', async t => {
	if (runGcRegressionInChild(t, import.meta.url)) return;
	assert.ok(globalThis.gc);
	function old() { const record = meter('retired'); const owner = Object.freeze([record]); productionStripMeter(owner, 'track', 'retired'); return { owner: new WeakRef(owner), record: new WeakRef(record) }; }
	const retired = old(); productionStripMeter(Object.freeze([meter('current')]), 'track', 'current');
	for (let i = 0; i < 8; i++) { await new Promise<void>(resolve => setImmediate(resolve)); globalThis.gc(); }
	assert.equal(retired.owner.deref(), undefined); assert.equal(retired.record.deref(), undefined);
});
