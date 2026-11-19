/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';
import { createBrowserCoverageObserverRoutes } from '../scripts/lib/browser-coverage-observer-routes.mjs';

const ORIGIN = 'http://127.0.0.1:4380';
const SOURCE = 'export function ordinary() { return 1; }\nordinary();\n';
const OBSERVER_PATH = '/__lightscaper_develop_gpu_preview_current.js', OBSERVER_SOURCE = 'export const observed = 1;';
const SKIPPED = { status: 'skipped', errors: [], project: { name: 'chromium' } };

test('an actual skipped ordinary test still drains page and worker coverage without claiming GPU execution', async context => {
	const f = await fixture(context);
	const file = await f.collector.collect('actual native capability skip', new Set<string>(), SKIPPED);
	assert.ok(file);
	const profile: unknown = JSON.parse(await readFile(file, 'utf8'));
	assert.ok(profile && typeof profile === 'object' && 'result' in profile && Array.isArray(profile.result));
	assert.deepEqual(profile.result.map((value: { url: string }) => value.url), [f.url, f.url]);
	assert.ok('built-gpu-execution' in profile); assert.equal(profile['built-gpu-execution'], null);
	assert.ok('built-gpu-qualification-skipped' in profile);
	assert.deepEqual(profile['built-gpu-qualification-skipped'], { status: 'skipped', project: 'chromium' });
	f.assertDrained();
});

for (const outcome of [undefined, { ...SKIPPED, status: 'passed' }, { ...SKIPPED, status: 'failed' },
	{ ...SKIPPED, status: 'timedOut' }, { ...SKIPPED, status: 'interrupted' },
	{ ...SKIPPED, project: { name: 'lightscaper-software-gpu' } }, { ...SKIPPED, project: { name: 'unqualified-chromium' } },
	{ ...SKIPPED, errors: [{ message: 'actual body failure' }] }]) {
	test(`GPU qualification remains strict for ${JSON.stringify(outcome)}`, async context => {
		const f = await fixture(context);
		await assert.rejects(f.collector.collect('strict GPU admission', new Set<string>(), outcome), /requires executed broker and WebGL functions/u);
		f.assertDrained();
	});
}

test('a skipped test cannot hide a registered observer that never executed', async context => {
	const f = await fixture(context);
	f.owner.register('/__lightscaper_develop_gpu_preview_current.js', 'export const observed = 1;');
	await assert.rejects(f.collector.collect('unexecuted observer', new Set<string>(), SKIPPED), /not source-attested/u);
	f.assertDrained();
});

test('a later skip after genuine observer execution still requires built GPU coverage', async context => {
	const f = await fixture(context);
	f.owner.register(OBSERVER_PATH, OBSERVER_SOURCE);
	f.pageSession.observerExecuted = true;
	await assert.rejects(f.collector.collect('late skip after observer', new Set<string>(), SKIPPED), /requires executed broker and WebGL functions/u);
	f.assertDrained();
});

test('a skipped test cannot hide a real worker collection failure', async context => {
	const failure = new Error('actual worker coverage failed');
	const f = await fixture(context, failure);
	await assert.rejects(f.collector.collect('worker failure', new Set<string>(), SKIPPED), failure);
	assert.equal(f.pageSession.detached, true);
	f.assertReleased();
});

async function fixture(context: TestContext, workerFailure?: Error) {
	const root = await mkdtemp(join(tmpdir(), 'browser-coverage-skipped-gpu-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const built = join(root, 'lightscaper'), asset = join(built, 'assets/ordinary.js');
	await mkdir(join(built, 'assets'), { recursive: true });
	await mkdir(join(root, 'lightscaper-source-maps'), { recursive: true });
	await mkdir(join(root, 'config'));
	for (const name of ['ffmpeg-runtime-manifest.json', 'ffmpeg-runtime-publication-policy.json']) {
		await writeFile(join(root, 'config', name), await readFile(new URL(`../config/${name}`, import.meta.url)));
	}
	await writeFile(asset, SOURCE);
	await writeFile(join(root, 'lightscaper-source-maps/ordinary.js.map'), JSON.stringify({ version: 3,
		sources: [pathToFileURL(join(root, 'src/ordinary.ts')).href], sourcesContent: [SOURCE], names: [], mappings: 'AAAA' }));
	const owner = createBrowserCoverageObserverRoutes({ testFile: '/tests/browser/lightscaper-develop-gpu-preview-current.spec.js', origin: ORIGIN });
	assert.ok(owner);
	const pageSession = new Session('page'), workerSession = new Session('worker', workerFailure);
	const createChildSession = (_sessionId: string) => workerSession;
	const browserRoot = Object.assign(new EventEmitter(), { createChildSession });
	browserRoot.on('Target.attachedToTarget', ({ sessionId }: { sessionId: string }) => { browserRoot.createChildSession(sessionId); assert.equal(sessionId, 'owned-worker'); });
	const implementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	const browser = { _connection: { toImpl: () => implementation }, async newBrowserCDPSession() {} };
	const page = { isClosed: () => false, context: () => ({ newCDPSession: async () => pageSession }) };
	const collector = createBrowserCoverageCollector({ browserName: 'chromium', environment: { SCAPE_BROWSER_COVERAGE: '1' },
		repositoryRoot: root, coverageDirectory: join(root, 'coverage'), observerOwner: owner,
		sites: [{ origin: ORIGIN, outputDirectory: built, productId: 'lightscaper' }] });
	assert.ok(collector);
	collector.attach({ pages: () => [page], browser: () => browser, on() {} });
	await collector.settle();
	browserRoot.emit('Target.attachedToTarget', { sessionId: 'owned-worker',
		targetInfo: { targetId: 'owned-worker-target', type: 'worker', url: `${ORIGIN}/assets/ordinary.js` }, waitingForDebugger: true });
	await collector.settle();
	const assertReleased = () => {
		assert.equal(browserRoot.createChildSession, createChildSession, 'coverage releases the maintained Playwright interception');
		assert.equal(browserRoot.listenerCount('Target.attachedToTarget'), 1, 'only Playwright attachment remains');
		assert.equal(browserRoot.listenerCount('Target.detachedFromTarget'), 0);
		assert.equal(implementation.listenerCount('disconnected'), 0);
	};
	return { collector, owner, pageSession, workerSession, url: pathToFileURL(asset).href,
		assertReleased,
		assertDrained() {
			assert.equal(pageSession.detached, true);
			for (const session of [pageSession, workerSession]) {
				assert.ok(session.sent.includes('Profiler.takePreciseCoverage'));
				assert.ok(session.sent.includes('Profiler.stopPreciseCoverage'));
				assert.ok(session.sent.includes('Profiler.disable'));
				assert.ok(session.sent.includes('Debugger.disable'));
			}
			assertReleased();
		} };
}

class Session extends EventEmitter {
	readonly sent: string[] = [];
	detached = false;
	observerExecuted = false;
	constructor(readonly kind: 'page' | 'worker', readonly failure?: Error) { super(); }
	async detach() { this.detached = true; }
	async send(method: string) {
		this.sent.push(method);
		if (method === 'Profiler.takePreciseCoverage') {
			if (this.failure) throw this.failure;
			return { result: [{ scriptId: this.kind, url: `${ORIGIN}/assets/ordinary.js`, functions: [
				{ functionName: 'ordinary', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: SOURCE.length, count: 1 }] },
			] }, ...this.observerExecuted ? [{ scriptId: 'observer', url: ORIGIN + OBSERVER_PATH, source: OBSERVER_SOURCE, functions: [
				{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: OBSERVER_SOURCE.length, count: 1 }] },
			] }] : []] };
		}
		return {};
	}
}
