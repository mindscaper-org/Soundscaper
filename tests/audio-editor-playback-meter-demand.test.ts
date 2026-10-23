/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { canonicalStripRefKey, type StripRef } from '../src/common/editor/parameter-address.ts';
import { enableParallelProductionMeterSessionV21, sampleProductionMeterSessionV21, suspendParallelProductionMeterSessionV21 } from '../src/common/editor/engine/production-meter-runtime-session-v21.ts';
import { acquirePlaybackMeterDemand, clearPlaybackMeterDemand, enablePlaybackMeterDemand, readPlaybackMeterDemand } from '../src/common/editor/engine/playback-meter-demand.ts';
import { createProductionStripMeterWorkerRuntime } from '../src/common/editor/engine/production-strip-meter-worker-runtime.ts';
import type { ProductionStripMeterWorkerPort } from '../src/common/editor/engine/production-strip-meter-worker-client.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { engineTransportSchedulerMethods } from '../src/common/editor/engine/transport-scheduler.ts';
import { ENGINE_EMIT_METERS } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineMeterSnapshot } from '../src/common/editor/engine/public-api.ts';
import type { StripMeterAnalyserBankV21 } from '../src/common/editor/engine/strip-meter-analyser-bank-v21.ts';

test('production sampling reads only demanded strips and resumes newly visible strips next tick', () => {
	const visible = bank({ kind: 'track', id: 'visible' });
	const hidden = bank({ kind: 'track', id: 'hidden' });
	const banks = new Map([['visible', visible.value], ['hidden', hidden.value]]);
	const owner = {}, project = {};
	const demand = new Set([canonicalStripRefKey(visible.value.strip)]);
	sampleProductionMeterSessionV21(owner, project, banks, null, demand);
	assert.equal(visible.reads(), 1);
	assert.equal(hidden.reads(), 0, 'hidden idle strips must not read or transfer PCM');
	demand.add(canonicalStripRefKey(hidden.value.strip));
	sampleProductionMeterSessionV21(owner, project, banks, null, demand);
	assert.equal(hidden.reads(), 1, 'a newly visible strip is sampled on the next shared tick');
});

test('visible leases share strip demand while master, armed tracks and headless consumers retain their meters', () => {
	const owner = {};
	const project = { tracks: [{ id: 'armed', armed: true }, { id: 'idle', armed: false }] };
	const strip = { kind: 'track', id: 'visible' } as const;
	assert.equal(readPlaybackMeterDemand(owner, project), null);
	enablePlaybackMeterDemand(owner);
	assert.equal(readPlaybackMeterDemand(owner, project), null, 'full metering is retained before the first UI lease');
	const releaseTimeline = acquirePlaybackMeterDemand(owner, strip);
	const releaseMixer = acquirePlaybackMeterDemand(owner, strip);
	const expected = [strip, { kind: 'master' }, { kind: 'track', id: 'armed' }].map(value => canonicalStripRefKey(value as StripRef));
	assert.deepEqual(readPlaybackMeterDemand(owner, project), new Set(expected));
	releaseTimeline(); releaseTimeline();
	assert.deepEqual(readPlaybackMeterDemand(owner, project), new Set(expected));
	releaseMixer();
	assert.equal(readPlaybackMeterDemand(owner, project)?.has(canonicalStripRefKey(strip)), false);
	clearPlaybackMeterDemand(owner);
	assert.equal(readPlaybackMeterDemand(owner, project), null);
});

test('hidden legacy strips also skip reads, while armed tracks and master continue', () => {
	const master = bank({ kind: 'master' });
	const hidden = bank({ kind: 'track', id: 'hidden' });
	const armed = bank({ kind: 'track', id: 'armed' });
	const legacyHidden = countedAnalyser(0.25);
	const { host, readings } = samplingHost(new Map([['master', master.value], ['hidden', hidden.value], ['armed', armed.value]]),
		new Map([['hidden', legacyHidden.value], ['armed', countedAnalyser(0.25).value]]));
	host.project = { ...host.project, tracks: [{ id: 'armed', armed: true }] } as typeof host.project;
	enablePlaybackMeterDemand(host);
	const release = acquirePlaybackMeterDemand(host, { kind: 'master' });
	engineTransportSchedulerMethods[ENGINE_EMIT_METERS].call(host);
	assert.equal(hidden.reads(), 0);
	assert.equal(legacyHidden.reads(), 0);
	assert.equal(master.reads(), 1);
	assert.equal(armed.reads(), 1);
	assert.deepEqual(Object.keys(readings[0]!.tracks), ['armed']);
	release();
});

test('first pending worker result uses scalar fallback and a failed worker resumes channel metering', () => {
	const track = bank({ kind: 'track', id: 'track' });
	const legacy = countedAnalyser(0.25);
	const banks = new Map([['track', track.value]]);
	const { host, readings } = samplingHost(banks, new Map([['track', legacy.value]]));
	const worker = new MeterWorker();
	enableParallelProductionMeterSessionV21(host, { createWorker: () => worker });
	try {
		engineTransportSchedulerMethods[ENGINE_EMIT_METERS].call(host);
		assert.equal(legacy.reads(), 1);
		assert.equal(readings.at(-1)?.tracks.track?.peak, 0.25);
		worker.reply();
		engineTransportSchedulerMethods[ENGINE_EMIT_METERS].call(host);
		assert.equal(legacy.reads(), 1, 'completed channel readings avoid a second mono scan');
		assert.equal(readings.at(-1)?.tracks.track?.peak, 0.5);
		worker.fail();
		engineTransportSchedulerMethods[ENGINE_EMIT_METERS].call(host);
		assert.equal(legacy.reads(), 1);
		assert.equal(readings.at(-1)?.tracks.track?.peak, 0.5, 'worker failure computes current channel readings synchronously');
		banks.clear();
		engineTransportSchedulerMethods[ENGINE_EMIT_METERS].call(host);
		assert.equal(legacy.reads(), 2, 'a retired bank must restore its scalar fallback');
	} finally { suspendParallelProductionMeterSessionV21(host); }
});

test('engine disposal clears visibility leases even before the UI unmounts', async () => {
	const engine = createAudioEditorEngine();
	enablePlaybackMeterDemand(engine);
	const release = acquirePlaybackMeterDemand(engine, { kind: 'track', id: 'visible' });
	assert.ok(readPlaybackMeterDemand(engine, null));
	await engine.dispose();
	assert.equal(readPlaybackMeterDemand(engine, null), null);
	release();
});

test('production channel readings replace legacy scans while absent banks retain scalar fallback', () => {
	const master = bank({ kind: 'master' });
	const track = bank({ kind: 'track', id: 'track' });
	const legacy = countedAnalyser(0.25);
	const fallback = countedAnalyser(0.75);
	const { host, readings } = samplingHost(new Map([['master', master.value], ['track', track.value]]),
		new Map([['track', legacy.value], ['without-bank', fallback.value]]));
	engineTransportSchedulerMethods[ENGINE_EMIT_METERS].call(host);
	assert.equal(legacy.reads(), 0, 'a production channel snapshot makes the mono downmix scan redundant');
	assert.equal(fallback.reads(), 1);
	assert.equal(readings[0]?.tracks.track?.peak, 0.5);
	assert.equal(readings[0]?.tracks['without-bank']?.peak, 0.75);
});

function samplingHost(banks: ReadonlyMap<string, StripMeterAnalyserBankV21>, tracks: Map<string, AnalyserNode>) {
	const readings: EngineMeterSnapshot[] = [];
	const host = {
		project: createSoundscaperProject({ id: 'meter-demand' }),
		graph: { productionStripAnalysersV21: banks, trackAnalysers: tracks, groupAnalysers: new Map(),
			sendAnalysers: new Map(), masterAnalyser: countedAnalyser(0.25).value },
		context: null, liveAnalysisLeaseCount: 0, latestMasterLoudnessMeter: null,
		meterListeners: new Set([(reading: EngineMeterSnapshot) => readings.push(reading)]),
	} as unknown as EngineRuntimeHost;
	return { host, readings };
}

function bank(strip: StripRef) {
	const analyser = countedAnalyser(0.5);
	return { reads: analyser.reads, value: {
		strip, output: {} as AudioNode, channelLabels: ['M'], analysers: [analyser.value],
	} satisfies StripMeterAnalyserBankV21 };
}

function countedAnalyser(peak: number) {
	let reads = 0;
	return { reads: () => reads, value: {
		fftSize: 256,
		getFloatTimeDomainData(output: Float32Array): void { reads++; output.fill(peak); },
	} as unknown as AnalyserNode };
}

class MeterWorker implements ProductionStripMeterWorkerPort {
	private readonly posts: unknown[] = [];
	private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
	postMessage(message: unknown): void { this.posts.push(message); }
	terminate(): void {}
	addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener); this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void { this.listeners.get(type)?.delete(listener); }
	reply(): void {
		createProductionStripMeterWorkerRuntime({ post: response => {
			for (const listener of this.listeners.get('message') ?? []) listener({ data: structuredClone(response) });
		} }).handleMessage(this.posts.shift());
	}
	fail(): void { for (const listener of this.listeners.get('error') ?? []) listener({}); }
}
