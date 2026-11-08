/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { MotionSustainedCdp } from '../scripts/performance/motionscaper-sustained-cdp.ts';

interface Request { readonly id: number; readonly method: string; readonly sessionId?: string }
class SyntheticSocket extends EventTarget {
	static latest: SyntheticSocket;
	static failOpen = false; static holdInitialClose = false;
	readonly sent: Request[] = [];
	closed = false; closeCalls = 0; closeEvents = 0; holdEnable = false; holdResume = false; holdClose = false; failEvaluation = false;
	constructor() {
		super(); SyntheticSocket.latest = this; this.holdClose = SyntheticSocket.holdInitialClose;
		queueMicrotask(() => this.dispatchEvent(new Event(SyntheticSocket.failOpen ? 'error' : 'open')));
	}
	send(data: string): void {
		assert.equal(this.closed, false);
		const request = JSON.parse(data) as Request; this.sent.push(request);
		if (this.holdEnable && request.method === 'Runtime.enable') return;
		if (this.holdResume && request.method === 'Runtime.runIfWaitingForDebugger') return;
		queueMicrotask(() => this.message({ id: request.id, ...(request.sessionId ? { sessionId: request.sessionId } : {}), result: this.failEvaluation && request.method === 'Runtime.evaluate'
			? { exceptionDetails: { text: 'Synthetic observation failure' } } : {} }));
	}
	message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
	attach(): void {
		this.message({ method: 'Target.attachedToTarget', params: { sessionId: 'worker-session',
			targetInfo: { targetId: 'worker-target', type: 'worker', url: 'http://127.0.0.1/motion-worker.js' } } });
	}
	remoteClose(): void {
		if (this.closed) return;
		this.closed = true; this.closeEvents++; this.dispatchEvent(new Event('close'));
	}
	close(): void { this.closeCalls++; if (!this.closed && !this.holdClose) queueMicrotask(() => this.remoteClose()); }
}
function install(t: TestContext): void {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'); assert.ok(original);
	Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: SyntheticSocket });
	SyntheticSocket.failOpen = false; SyntheticSocket.holdInitialClose = false;
	t.after(() => { SyntheticSocket.latest.remoteClose(); Object.defineProperty(globalThis, 'WebSocket', original); });
}
async function connect(t: TestContext) {
	install(t);
	const observer = await MotionSustainedCdp.connect('ws://127.0.0.1:12345/devtools/browser/synthetic');
	return { observer, socket: SyntheticSocket.latest };
}
async function microtasks(): Promise<void> { for (let index = 0; index < 24; index++) await Promise.resolve(); }
async function bounded<T>(operation: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Synthetic close missed the only socket close event.')), 250);
		})]);
	} finally { clearTimeout(timer); }
}

test('Motion sustained CDP close settles when the socket closes during pending observer preparation', async t => {
	const { observer, socket } = await connect(t);
	socket.holdEnable = true; socket.attach();
	assert.equal(socket.sent.at(-1)?.method, 'Runtime.enable');
	const closing = observer.close(); socket.remoteClose();
	await assert.rejects(bounded(closing), /CDP closed or observation concurrency exceeded/u);
	assert.equal(socket.closeEvents, 1); assert.equal(socket.closeCalls, 0);
	assert.equal(observer.identities()[0]?.ready, false);
	await assert.rejects(observer.close(), /CDP closed or observation concurrency exceeded/u); assert.equal(socket.closeEvents, 1);
});

test('Motion sustained CDP close waits for worker observation and resume before one physical close', async t => {
	const { observer, socket } = await connect(t); socket.attach();
	await bounded(observer.close());
	assert.deepEqual(socket.sent.map(request => request.method), [
		'Target.setAutoAttach', 'Runtime.enable', 'Runtime.evaluate', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger',
	]);
	assert.equal(observer.identities()[0]?.ready, true);
	assert.equal(socket.closed, true); assert.equal(socket.closeEvents, 1); assert.equal(socket.closeCalls, 1);
	await observer.close(); assert.equal(socket.closeCalls, 1);
});

test('Motion sustained CDP close preserves observation errors while closing a still-open channel', async t => {
	const { observer, socket } = await connect(t); socket.failEvaluation = true; socket.attach();
	await assert.rejects(bounded(observer.close()), /External WASM observation installation failed/u);
	assert.equal(socket.sent.at(-1)?.method, 'Runtime.runIfWaitingForDebugger');
	assert.equal(observer.identities()[0]?.ready, false);
	assert.equal(socket.closeEvents, 1); assert.equal(socket.closeCalls, 1);
});

test('Motion sustained CDP close bounds preparation and rejects pending work at its original deadline', async t => {
	const { observer, socket } = await connect(t); t.mock.timers.enable({ apis: ['setTimeout'] });
	socket.holdEnable = true; socket.holdResume = true; socket.holdClose = true; socket.attach();
	let settled = false, failure: unknown;
	const operation = observer.close().then(() => { settled = true; }, error => { failure = error; settled = true; });
	try {
		t.mock.timers.tick(9999); await microtasks(); assert.equal(settled, false);
		t.mock.timers.tick(1); await microtasks(); assert.equal(settled, true);
		assert.match(String(failure), /CDP close deadline exceeded/u);
		assert.deepEqual(observer.closure(), { state: 'unknown', physicallyClosed: false, closeRequested: true });
		assert.equal(socket.closeCalls, 1); assert.equal(socket.sent.some(value => value.method === 'Runtime.runIfWaitingForDebugger'), false);
		await assert.rejects(observer.ready(), /deadline|retired/u);
		const sent = socket.sent.length; socket.attach(); await microtasks(); assert.equal(socket.sent.length, sent);
		socket.remoteClose(); await microtasks();
		assert.deepEqual(observer.closure(), { state: 'closed', physicallyClosed: true, closeRequested: true });
		await assert.rejects(observer.close(), error => error === failure); assert.equal(socket.sent.length, sent); assert.equal(socket.closeCalls, 1);
	} finally { socket.remoteClose(); await operation; }
});

test('Motion sustained CDP close reports unknown physical closure when the socket never emits close', async t => {
	const { observer, socket } = await connect(t); t.mock.timers.enable({ apis: ['setTimeout'] }); socket.holdClose = true;
	let settled = false, failure: unknown;
	const operation = observer.close().then(() => { settled = true; }, error => { failure = error; settled = true; });
	try {
		await microtasks(); assert.equal(socket.closeCalls, 1);
		t.mock.timers.tick(9999); await microtasks(); assert.equal(settled, false);
		t.mock.timers.tick(1); await microtasks(); assert.equal(settled, true);
		assert.match(String(failure), /physical channel closure is unknown/u); assert.equal(socket.closed, false);
		assert.deepEqual(observer.closure(), { state: 'unknown', physicallyClosed: false, closeRequested: true });
	} finally { socket.remoteClose(); await operation; }
});

test('Motion sustained CDP close preserves preparation failure together with a physical-close deadline', async t => {
	const { observer, socket } = await connect(t); t.mock.timers.enable({ apis: ['setTimeout'] });
	socket.failEvaluation = true; socket.holdClose = true; socket.attach();
	let settled = false, failure: unknown;
	const operation = observer.close().then(() => { settled = true; }, error => { failure = error; settled = true; });
	try {
		await microtasks(); assert.equal(socket.closeCalls, 1);
		t.mock.timers.tick(10000); await microtasks(); assert.equal(settled, true);
		assert.match(String(failure), /External WASM observation installation failed/u);
		assert.match(String(failure), /CDP close deadline exceeded/u); assert.equal(socket.closed, false);
	} finally { socket.remoteClose(); await operation; }
});

test('Motion sustained CDP concurrent close shares one preparation drain and physical close request', async t => {
	const { observer, socket } = await connect(t); socket.attach();
	const first = observer.close(), second = observer.close();
	try { assert.equal(first, second); } finally { await Promise.allSettled([first, second]); }
	assert.equal(socket.closeCalls, 1); assert.equal(socket.closeEvents, 1);
});

test('Motion sustained CDP failed close remains the same failure after a late physical close', async t => {
	const { observer, socket } = await connect(t); t.mock.timers.enable({ apis: ['setTimeout'] }); socket.holdClose = true;
	const first = observer.close(); let failure: unknown;
	const observed = first.catch(error => { failure = error; });
	await microtasks(); t.mock.timers.tick(10000); await observed;
	assert.match(String(failure), /CDP close deadline exceeded/u);
	socket.remoteClose(); assert.equal(observer.closure().physicallyClosed, true);
	const second = observer.close(); assert.equal(second, first);
	await assert.rejects(second, error => error === failure);
	assert.equal(socket.closeCalls, 1); assert.equal(socket.closeEvents, 1);
});

test('Motion sustained CDP opening failure physically closes its already owned socket', async t => {
	install(t); SyntheticSocket.failOpen = true;
	await assert.rejects(MotionSustainedCdp.connect('ws://127.0.0.1:12345/devtools/browser/synthetic'), /CDP connection failed/u);
	assert.equal(SyntheticSocket.latest.closeCalls, 1); assert.equal(SyntheticSocket.latest.closed, true);
});

test('Motion sustained CDP opening failure retains unknown closure when cleanup also reaches its deadline', async t => {
	install(t); t.mock.timers.enable({ apis: ['setTimeout'] }); SyntheticSocket.failOpen = true; SyntheticSocket.holdInitialClose = true;
	let settled = false, failure: unknown;
	const operation = MotionSustainedCdp.connect('ws://127.0.0.1:12345/devtools/browser/synthetic')
		.then(() => { settled = true; }, error => { failure = error; settled = true; });
	try {
		await microtasks(); assert.equal(settled, false); assert.equal(SyntheticSocket.latest.closeCalls, 1);
		t.mock.timers.tick(10000); await microtasks(); assert.equal(settled, true);
		assert.match(String(failure), /CDP connection failed/u); assert.match(String(failure), /physical channel closure is unknown/u);
		assert.equal(SyntheticSocket.latest.closed, false);
	} finally { SyntheticSocket.latest.remoteClose(); await operation; }
});

test('Motion sustained CDP hands off transport ownership synchronously before opening errors and preserves callback failures', async t => {
	install(t); t.mock.timers.enable({ apis: ['setTimeout'] });
	SyntheticSocket.failOpen = true; SyntheticSocket.holdInitialClose = true;
	let owned: MotionSustainedCdp | undefined, failure: unknown;
	const operation = MotionSustainedCdp.connect('ws://127.0.0.1:12345/devtools/browser/synthetic', observer => { owned = observer; })
		.catch(error => { failure = error; });
	try {
		assert.ok(owned, 'The launch owner must retain the created transport before any await.');
		await microtasks(); t.mock.timers.tick(10000); await operation;
		assert.match(String(failure), /CDP connection failed/u); assert.equal(owned.closure().state, 'unknown');
		SyntheticSocket.latest.remoteClose(); assert.equal(owned.closure().physicallyClosed, true);
		await assert.rejects(owned.close(), /CDP close deadline exceeded/u);
	} finally { SyntheticSocket.latest.remoteClose(); await operation; }
	SyntheticSocket.failOpen = false; SyntheticSocket.holdInitialClose = false;
	const callbackFailure = new Error('Launch custody handoff failed.');
	await assert.rejects(MotionSustainedCdp.connect('ws://127.0.0.1:12345/devtools/browser/synthetic', () => { throw callbackFailure; }), error => error === callbackFailure);
	assert.equal(SyntheticSocket.latest.closed, true);
});
