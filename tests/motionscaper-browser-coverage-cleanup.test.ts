/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';

import { ownCoverageSessionListeners } from '../scripts/lib/browser-coverage-cleanup.ts';
import { createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';
import { createBrowserServiceWorkerCoverageCollector } from '../scripts/lib/browser-service-worker-coverage.mjs';
import { NAVIGATION_COVERAGE_CHECKPOINT_URL } from '../scripts/lib/navigation-coverage-checkpoint.mjs';

test('a failed page start releases the persistent browser and context listener', async t => {
	const failure = new Error('page profiler startup');
	const page = new FakePage(); page.session.failures.set('Profiler.enable', failure);
	const f = fixture(t, [page]);
	f.collector.attach(f.context);
	await assert.rejects(f.collector.settle(), error => error === failure);
	await assert.rejects(f.collector.collect('failed start', new Set()), error => error === failure);
	await assertReleased(f);
});

test('pending failure waits for a delayed second start before disposing either session', async t => {
	const failure = new Error('first page start');
	const first = new FakePage(), second = new FakePage();
	first.session.failures.set('Profiler.enable', failure);
	const opening = deferred<FakeSession>(); second.opening = opening.promise;
	const f = fixture(t, [first, second]); f.collector.attach(f.context);
	let settled = false;
	const collection = f.collector.collect('delayed start', new Set()).finally(() => { settled = true; });
	void collection.catch(() => undefined);
	try {
		await setImmediate();
		assert.equal(settled, false, 'a rejected sibling must not race the still-opening page');
		assert.equal(first.session.detached, false);
	} finally { opening.resolve(second.session); }
	await assert.rejects(collection, error => error === failure);
	await assertReleased(f);
	assert.equal(second.session.detached, true);
});

test('a failed worker startup still releases browser-wide target interception', async t => {
	const worker = new FakeSession(); const failure = new Error('worker debugger startup');
	worker.failures.set('Debugger.enable', failure);
	const playwrightListener = () => undefined; worker.on('Debugger.scriptParsed', playwrightListener);
	const f = fixture(t, [], worker); f.collector.attach(f.context);
	await assert.rejects(f.collector.collect('worker start', new Set()), error => error === failure);
	assert.deepEqual(worker.listeners('Debugger.scriptParsed'), [playwrightListener]);
	assert.equal(worker.listenerCount('Runtime.executionContextsCleared'), 0);
	f.implementation._serviceWorkers.clear();
	await assertReleased(f);
});

test('a rejected navigation checkpoint releases page and browser state', async t => {
	const page = new FakePage(); const f = fixture(t, [page]); f.collector.attach(f.context);
	await f.collector.settle();
	const failure = new Error('navigation checkpoint');
	page.session.failures.set('Profiler.takePreciseCoverage', failure);
	page.session.emit('Debugger.scriptParsed', { scriptId: 'hook', executionContextId: 1, url: NAVIGATION_COVERAGE_CHECKPOINT_URL });
	page.session.emit('Debugger.paused', { callFrames: [{ functionName: '__soundscaperCoverageBeforeUnload', location: { scriptId: 'hook' } }] });
	await setImmediate();
	await assert.rejects(f.collector.collect('checkpoint failure', new Set()), error => error === failure);
	await assertReleased(f);
});

test('a page stop failure still disables and detaches its session without publishing a profile', async t => {
	const page = new FakePage(); const f = fixture(t, [page]); f.collector.attach(f.context);
	await f.collector.settle();
	const failure = new Error('page stop'); page.session.failures.set('Profiler.stopPreciseCoverage', failure);
	await assert.rejects(f.collector.collect('stop failure', new Set()), error => error === failure);
	assert.ok(page.session.sent.includes('Debugger.disable'));
	await assertReleased(f);
});

test('primary collection and cleanup errors both survive while other resources release', async t => {
	const primary = new Error('page start'), cleanup = new Error('page detach');
	const page = new FakePage(); page.session.failures.set('Profiler.enable', primary); page.session.detachFailure = cleanup;
	const f = fixture(t, [page]); f.collector.attach(f.context);
	await assert.rejects(f.collector.collect('two failures', new Set()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(leaves(error), [primary, cleanup]);
		return true;
	});
	await assertReleased(f);
});

test('worker cleanup still detaches the root after disable-auto-attach fails', async () => {
	const failure = new Error('disable auto attach'); let detached = 0;
	const root = Object.assign(new EventEmitter(), {
		async send(_method: string, params: { autoAttach?: boolean }) { if (params.autoAttach === false) throw failure; return {}; },
		async detach() { detached++; },
	});
	const collector = createBrowserServiceWorkerCoverageCollector({ rootSession: root, openTargetSession: () => new FakeSession() });
	await collector.start();
	await assert.rejects(collector.collect(), error => error === failure);
	assert.equal(detached, 1);
});

test('worker child-close and root-detach cleanup failures are aggregated', async () => {
	const childFailure = new Error('child close'), rootFailure = new Error('root detach'); let detached = 0;
	const child = new FakeSession(); child.closeFailure = childFailure;
	const root = Object.assign(new EventEmitter(), {
		async send() { return {}; }, async detach() { detached++; throw rootFailure; },
	});
	const collector = createBrowserServiceWorkerCoverageCollector({ rootSession: root, openTargetSession: () => child });
	await collector.start();
	root.emit('Target.attachedToTarget', { sessionId: 'worker', targetInfo: { type: 'service_worker', url: 'http://127.0.0.1/worker.js' } });
	await collector.settle();
	await assert.rejects(collector.collect(), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(leaves(error), [childFailure, rootFailure]); return true;
	});
	assert.equal(detached, 1);
});

test('shared session cleanup removes duplicate owned registrations without removing foreign listeners', () => {
	const session = new EventEmitter();
	const foreign = () => undefined, callback = () => undefined;
	session.on('script', foreign);
	const owned = ownCoverageSessionListeners(session);
	owned.on('script', callback); owned.on('script', callback);
	owned.close();
	assert.deepEqual(session.listeners('script'), [foreign]);
	owned.off('script', foreign);
	assert.deepEqual(session.listeners('script'), [foreign]);
});

function fixture(t: TestContext, pages: FakePage[], worker?: FakeSession) {
	const directory = mkdtempSync(join(tmpdir(), 'motionscaper-coverage-cleanup-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const root = Object.assign(new EventEmitter(), { createChildSession() { return new FakeSession(); } });
	const original = root.createChildSession;
	const implementation = Object.assign(new EventEmitter(), { _session: root,
		_serviceWorkers: worker ? new Map([['worker-target', { _session: worker }]]) : new Map() });
	const browser = { _connection: { toImpl: () => implementation }, async newBrowserCDPSession() {} };
	const context = new FakeContext(pages, browser);
	const options = { browserName: 'chromium', environment: { SCAPE_BROWSER_COVERAGE: '1' },
		sites: [{ origin: 'http://127.0.0.1:4322', outputDirectory: directory, productId: 'motionscaper' as const }],
		coverageDirectory: join(directory, 'coverage') };
	const collector = createBrowserCoverageCollector(options); assert.ok(collector);
	return { pages, context, collector, root, original, implementation, browser, options };
}

async function assertReleased(f: ReturnType<typeof fixture>) {
	assert.equal(f.root.createChildSession, f.original, 'original browser interception is restored');
	assert.equal(f.root.listenerCount('Target.attachedToTarget'), 0);
	assert.equal(f.root.listenerCount('Target.detachedFromTarget'), 0);
	assert.equal(f.implementation.listenerCount('disconnected'), 0);
	assert.equal(f.context.listenerCount('page'), 0);
	for (const page of f.pages) {
		assert.equal(page.session.detached, true);
		assert.deepEqual(page.session.eventNames(), [], 'page CDP callbacks no longer retain recorder state');
		assert.equal(page.goto, page.originalGoto, 'page operation interception is restored');
	}
	assert.equal(existsSync(f.options.coverageDirectory), false, 'failed collection must not publish partial coverage');
	const next = createBrowserCoverageCollector(f.options); assert.ok(next);
	next.attach(new FakeContext([], f.browser));
	await next.settle();
	assert.equal(await next.collect('following test', new Set()), null, 'same persistent browser accepts a new collector');
	assert.equal(f.root.createChildSession, f.original);
}

class FakeSession extends EventEmitter {
	_sessionId = 'worker-session';
	failures = new Map<string, Error>();
	sent: string[] = [];
	detached = false;
	detachFailure: Error | null = null;
	closeFailure: Error | null = null;
	async send(method: string): Promise<unknown> {
		this.sent.push(method);
		const failure = this.failures.get(method); if (failure) throw failure;
		if (method === 'Profiler.takePreciseCoverage') return { result: [] };
		if (method === 'Debugger.getScriptSource') return { scriptSource: '' };
		if (method === 'Runtime.evaluate') return { result: { value: true } };
		return {};
	}
	async detach(): Promise<void> { this.detached = true; if (this.detachFailure) throw this.detachFailure; }
	close(): void { if (this.closeFailure) throw this.closeFailure; this.emit('close'); }
}

class FakePage {
	session = new FakeSession();
	opening: Promise<FakeSession> | null = null;
	owner!: FakeContext;
	originalGoto = async () => undefined;
	goto = this.originalGoto;
	isClosed() { return false; }
	context() { return this.owner; }
}

class FakeContext extends EventEmitter {
	constructor(private readonly values: FakePage[], private readonly value: { _connection: { toImpl(): EventEmitter }; newBrowserCDPSession(): Promise<void> }) {
		super(); for (const page of values) page.owner = this;
	}
	pages() { return this.values; }
	browser() { return this.value; }
	async newCDPSession(page: FakePage) { return page.opening ?? page.session; }
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(done => { resolve = done; });
	return { promise, resolve };
}

function leaves(error: unknown): unknown[] {
	return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}
