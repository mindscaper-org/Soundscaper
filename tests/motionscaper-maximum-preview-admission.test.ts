import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { previewMotionMaximum } from '../desktop/motionscaper-native-maximum-ui.ts';

const output = await mkdtemp(join(tmpdir(), 'motionscaper-max-preview-admission-'));
after(async () => { await rm(output, { recursive: true, force: true }); });
type Application = Parameters<typeof previewMotionMaximum>[0];

async function until(check: () => boolean) {
	const deadline = performance.now() + 1500;
	while (!check()) {
		assert.ok(performance.now() < deadline, 'The controlled fixture did not reach its requested checkpoint.');
		await delay(5);
	}
}

function fixture(blockFirstRead = false) {
	let ready = false, opened = false, samples = 0, enabledReads = 0;
	let failObservation = false, observationRejected = false;
	let releaseRead!: (value: boolean) => void;
	const delayedRead = new Promise<boolean>((resolve) => { releaseRead = resolve; });
	const fills: string[] = [];
	const admitted = new Error('fixture stopped after the admitted Frame fill');
	const observation = new Error('fixture observer rejected while first paint was pending');
	const identity = { pid: 100, parentPid: 1, startTicks: '1' };
	const frame = {
		async isEnabled() {
			enabledReads++;
			if (blockFirstRead && enabledReads === 1) return delayedRead;
			return ready;
		},
		async fill(value: string) {
			fills.push(value);
			if (!ready) throw new Error('Frame fill was attempted before initial paint readiness');
			throw admitted;
		},
	};
	const dialog = {
		getByLabel(name: string) { assert.equal(name, 'Frame'); return frame; },
		locator(name: string) {
			assert.equal(name, 'canvas');
			return { getAttribute() { throw new Error('Pixel inspection must follow the controlled fill boundary.'); } };
		},
	};
	const fake = {
		owner: identity,
		page: {
			getByRole(role: string, options: { name: string }) {
				if (role === 'menuitem') return { async click() { if (options.name === 'Composition Preview') opened = true; } };
				assert.equal(role, 'dialog'); assert.equal(options.name, 'Composition Preview'); return dialog;
			},
		},
		async sampleProcesses() {
			return { processes: [{ identity, rssBytes: 1024, pssBytes: 512, details: {} }], rssBytes: 1024, pssBytes: 512 };
		},
		cdp: {
			async sample() {
				samples++;
				if (failObservation) { observationRejected = true; throw observation; }
				return [{ type: 'page', sessionId: 'fixture-page', monotonicMs: performance.now(), usedHeapBytes: 1,
					totalHeapBytes: 2, wasmCapacityBytes: [8], workerFrames: 0 }];
			},
		},
	};
	return {
		// One explicit fake-application boundary. No real page, process, browser or application is created.
		application: fake as unknown as Application,
		fills, admitted, observation,
		opened: () => opened, samples: () => samples, reads: () => enabledReads,
		observationRejected: () => observationRejected,
		paint() { ready = true; },
		failObserver() { failObservation = true; },
		releaseRead,
	};
}

async function start(name: string, blocked = false) {
	const value = fixture(blocked), directory = join(output, name);
	await mkdir(directory, { recursive: false });
	const running = previewMotionMaximum(value.application, 'planes', directory);
	void running.catch(() => undefined);
	await until(value.opened);
	return { ...value, directory, running };
}

test('Motion maximum waits without filling, keeps observing, then admits the original Frame fill', { timeout: 2500 }, async () => {
	const value = await start('ready');
	try {
		await delay(35);
		assert.deepEqual(value.fills, [], 'No fill is admitted while initial pixels are pending.');
		await until(() => value.samples() >= 2);
		assert.ok(value.reads() >= 1);
		value.paint();
		await assert.rejects(value.running, (error: unknown) => error === value.admitted);
		assert.deepEqual(value.fills, ['0']);
		const rows = (await readFile(join(value.directory, 'preview-memory.jsonl'), 'utf8')).trim().split('\n');
		assert.ok(rows.length >= 2, 'The original memory/progress sampler remains active before first paint.');
	} finally { value.paint(); value.releaseRead(false); await value.running.catch(() => undefined); }
});

test('Motion maximum observer failure cancels the readiness wait without a late fill', { timeout: 2500 }, async () => {
	const value = await start('observer');
	try {
		await delay(35);
		assert.deepEqual(value.fills, []);
		value.failObserver();
		await assert.rejects(value.running, (error: unknown) => error === value.observation);
		value.paint(); await delay(75);
		assert.deepEqual(value.fills, [], 'Later readiness cannot revive the failed preview admission.');
	} finally { value.paint(); value.releaseRead(false); await value.running.catch(() => undefined); }
});

test('Motion maximum abort drains an in-flight readiness read and refuses its late true result', { timeout: 2500 }, async () => {
	const value = await start('drain', true);
	let settled = false;
	void value.running.then(() => { settled = true; }, () => { settled = true; });
	try {
		await delay(35);
		assert.deepEqual(value.fills, []);
		await until(() => value.reads() === 1);
		value.failObserver();
		await until(value.observationRejected);
		assert.equal(settled, false, 'The original cancellation path drains the outstanding admission read.');
		value.paint(); value.releaseRead(true);
		await assert.rejects(value.running, (error: unknown) => error === value.observation);
		await delay(50);
		assert.deepEqual(value.fills, [], 'Abort is rechecked after the asynchronous read before any fill.');
	} finally { value.paint(); value.releaseRead(false); await value.running.catch(() => undefined); }
});
