/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the PipeWire session may claim about a connect it has only queued.
 *
 * `pw_stream_connect` is asynchronous: a non-negative return says the request
 * reached the graph, not that a node exists, that the format was accepted, or
 * that exclusive access was granted. Everything after that arrives on the loop
 * thread, so these probes drive a stub graph that answers late, answers with a
 * different format, or never answers at all, and assert that the open reports
 * what actually happened rather than what was asked for.
 *
 * A refusal that never happens is worse here than anywhere else in the addon:
 * a fabricated success stops the candidate chain, so the ALSA backup is never
 * tried and the failure surfaces much later as device loss.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackendStubs } from './helpers/native-backend-stubs.js';
import {
	addonIsBuilt,
	addonPath,
	childObservation,
	compilerIsAvailable,
	runChildModule,
} from './helpers/native-helper-c-harness.js';

const OUTPUT = 1;

const stubRoot = addonIsBuilt && compilerIsAvailable() ? buildBackendStubs(['pipewire', 'alsa']) : null;

function probe(script, environment = {}) {
	const run = runChildModule(`
		import { createRequire } from 'node:module';
		const addon = createRequire(import.meta.url)(${JSON.stringify(addonPath)});
		const open = (request) => addon.openAudioDevice({
			candidates: [{ backend: 'pipewire', deviceHandle: request.direction === 0 ? '@DEFAULT_SOURCE@' : '@DEFAULT_SINK@' }],
			direction: ${OUTPUT},
			exclusive: 0,
			sampleRate: 48_000,
			periodFrames: 1_024,
			channelCount: 2,
			...request,
		});
		const report = (observation) => console.log(\`OBSERVED \${JSON.stringify(observation)}\`);
		${script}
	`, { env: { LD_LIBRARY_PATH: stubRoot, ...environment } });
	assert.equal(run.signal, null, `the addon must answer the stub graph rather than die on it:\n${run.stderr}`);
	return childObservation(run);
}

test('a graph that negotiates the requested format opens and reports it', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		if (result.session) addon.closeAudioDevice(result.session);
		report({
			status: result.status,
			rate: result.grantedSampleRate,
			channels: result.grantedChannelCount,
			backend: result.grantedBackend,
		});
	`);
	assert.deepEqual(observed, { status: 'ok', rate: 48_000, channels: 2, backend: 'pipewire' });
});

test('a queued connect that the graph never answers is not reported as a granted session', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		if (result.session) addon.closeAudioDevice(result.session);
		report({ status: result.status, detail: result.detail, session: Boolean(result.session) });
	`, { SOUNDSCAPER_STUB_PIPEWIRE: 'silent' });
	assert.equal(observed.status, 'device-unavailable',
		'a connect request that settled into nothing is not a session, whatever it returned');
	assert.equal(observed.session, false);
	assert.match(observed.detail, /negotiat/iu);
});

test('a graph that negotiates another rate is refused rather than reported as the request', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		if (result.session) addon.closeAudioDevice(result.session);
		report({ status: result.status, detail: result.detail, rate: result.grantedSampleRate });
	`, { SOUNDSCAPER_STUB_PIPEWIRE_RATE: '44100' });
	assert.equal(observed.status, 'format-refused');
	assert.match(observed.detail, /44100/u);
	assert.match(observed.detail, /48000/u);
});

test('a graph that negotiates another channel count is refused too', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({});
		if (result.session) addon.closeAudioDevice(result.session);
		report({ status: result.status, detail: result.detail, channels: result.grantedChannelCount });
	`, { SOUNDSCAPER_STUB_PIPEWIRE_CHANNELS: '1' });
	assert.equal(observed.status, 'format-refused');
	assert.match(observed.detail, /channel/iu);
});

test('a node the graph errors leaves the ALSA backup to be tried, not skipped', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({
			candidates: [
				{ backend: 'pipewire', deviceHandle: '@DEFAULT_SINK@' },
				{ backend: 'alsa', deviceHandle: 'stub' },
			],
		});
		if (result.session) addon.closeAudioDevice(result.session);
		report({
			status: result.status,
			backend: result.grantedBackend,
			fellBack: result.fellBack,
			attempts: result.attempts.map(({ backend, status }) => [backend, status]),
		});
	`, { SOUNDSCAPER_STUB_PIPEWIRE: 'error' });
	assert.equal(observed.status, 'ok');
	assert.equal(observed.backend, 'alsa', 'a node that errored during negotiation must not hold the chain');
	assert.equal(observed.fellBack, true);
	assert.deepEqual(observed.attempts, [['pipewire', 'device-unavailable'], ['alsa', 'ok']]);
});

test('an exclusive request is only granted once the graph has honoured it', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const result = open({ exclusive: 1 });
		if (result.session) addon.closeAudioDevice(result.session);
		report({ status: result.status, exclusive: result.grantedExclusive ?? null });
	`, { SOUNDSCAPER_STUB_PIPEWIRE: 'silent' });
	assert.equal(observed.status, 'device-unavailable');
	assert.equal(observed.exclusive, null,
		'a mode can only be reported as granted by a session that exists');
});

const incompleteCapture = [-1, -1, -1, -1];
for (const [name, mode, status, lostFrames, left, right] of [
	['waits for the rest of a capture packet', 'delayed', 'ok', 0, [0.25, 0.75, 1.25, 1.75], [0.5, 1, 1.5, 2]],
	['leaves an incomplete capture packet untouched on timeout', 'stalled', 'recovered', 4, incompleteCapture, incompleteCapture],
	['reports device loss while waiting for capture', 'lost', 'device-lost', 0, incompleteCapture, incompleteCapture],
	['ends capture when a replacement source could be linked', 'relink', 'device-lost', 0, incompleteCapture, incompleteCapture],
]) {
	test(`PipeWire ${name}`, { skip: !addonIsBuilt || stubRoot === null }, () => {
		const { elapsed, ...observed } = probe(`
			const result = open({ direction: 0, periodFrames: 256 });
			const channels = Array.from({ length: 2 }, () => new Float32Array(4).fill(-1));
			const started = performance.now();
			const { status, lostFrames } = addon.readAudioDevice(result.session, 4, channels);
			const elapsed = performance.now() - started;
			addon.closeAudioDevice(result.session);
			report({ status, lostFrames, elapsed, left: [...channels[0]], right: [...channels[1]] });
		`, { SOUNDSCAPER_STUB_PIPEWIRE: `capture-${mode}` });
		assert.deepEqual(observed, { status, lostFrames, left, right });
		assert.ok(elapsed < 1_000, `bounded read took ${elapsed} ms`);
	});
}

test('PipeWire drains the contiguous input prefix and reports an overrun before the next packet', {
	skip: !addonIsBuilt || stubRoot === null,
}, () => {
	const observed = probe(`
		const { session } = open({ direction: 0, periodFrames: 1 });
		function read() {
			const left = new Float32Array(16).fill(-1);
			const right = new Float32Array(16).fill(-1);
			const { status } = addon.readAudioDevice(session, 16, [left, right]);
			return { status, left: [...left], right: [...right] };
		}
		const first = read();
		const second = read();
		const afterGap = read();
		addon.closeAudioDevice(session);
		report({ first, second, afterGap });
	`, { SOUNDSCAPER_STUB_PIPEWIRE: 'capture-overrun' });
	for (const [offset, block] of [[0, observed.first], [16, observed.second]]) {
		assert.equal(block.status, 'ok');
		assert.deepEqual(block.left, Array.from({ length: 16 }, (_, index) => 0.25 + (offset + index) * 0.5));
		assert.deepEqual(block.right, Array.from({ length: 16 }, (_, index) => 0.5 + (offset + index) * 0.5));
	}
	assert.deepEqual(observed.afterGap, { status: 'recovered', left: Array(16).fill(-1), right: Array(16).fill(-1) });
});
