/* SPDX-License-Identifier: AGPL-3.0-only */
// Concurrent native readers must preserve immutable bytes across real workers.
import { fileURLToPath } from 'node:url';
import { expect, test, compileNativeImageHandoffScript }
	from './helpers/lightscaper-image-handoff-native-fixture.js';

const PROGRAM = '/__lightscaper_opfs_cross_worker_read.js';
const EXPECTED = [3, 11, 29, 47, 61, 83, 107, 127, 149, 167, 181, 199, 211, 227, 239, 251,
	1, 19, 37, 53, 71, 89, 109, 131, 151, 173, 191, 209, 223, 233, 241, 253];
// The two-second native request bounds exercise worker ownership directly.
test.use({ browserCoverage: false });
test.beforeEach(({ browserName }) => {
	test.skip(browserName === 'webkit', 'This native OPFS regression requires worker createSyncAccessHandle, absent in maintained Linux WebKit; managed fallback coverage runs separately.');
});
test.setTimeout(90000);

test('two native workers concurrently read one immutable Lightscaper resource', async ({ page }, info) => {
	const workers = [], nativeEnvironment = [];
	const onWorker = worker => {
		let resolveClose;
		const closed = new Promise(resolve => { resolveClose = resolve; });
		worker.once('close', () => resolveClose());
		workers.push({ worker, url: worker.url(), closed, closeObserved: false });
		void closed.then(() => { workers.find(row => row.worker === worker).closeObserved = true; });
	};
	page.on('worker', onWorker);
	let packet, primary, cleanupError;
	try {
		await page.exposeFunction('__assertCrossWorkerReadNativeEnvironment', async () => {
			let matches = 0;
			for (const row of workers) {
				const environment = await row.worker.evaluate(() => ({ location: location.href,
					secure: isSecureContext, isolated: crossOriginIsolated, kind: globalThis.constructor.name,
					directory: typeof navigator.storage.getDirectory, handler: typeof globalThis.onmessage,
					synchronousAccess: typeof Reflect.get(FileSystemFileHandle.prototype, 'createSyncAccessHandle') }));
				if (!new URL(environment.location).pathname.endsWith('/opfs-sync-worker.ts')) continue;
				matches++; row.url = environment.location; nativeEnvironment.push(environment);
				if (!environment.secure || !environment.isolated || environment.kind !== 'DedicatedWorkerGlobalScope'
					|| environment.directory !== 'function' || environment.handler !== 'function'
					|| environment.synchronousAccess !== 'function') throw new Error('Actual companion native environment differs: ' + JSON.stringify(environment));
			}
			if (matches !== 2) throw new Error('Exactly two initialized real production companions must be observed before the batch.');
		});
		const companion = await compileNativeImageHandoffScript('opfs-sync-worker.js',
			fileURLToPath(new URL('../../src/common/editor/storage/opfs-sync-worker.ts', import.meta.url)));
		if (companion.assets.length) throw new Error('Actual native companion must not add companion assets.');
		await page.route('**/opfs-sync-worker.ts', async route => {
			const response = await route.fetch(), headers = response.headers();
			delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/javascript';
			try { await route.fulfill({ status: 200, headers, body: companion.source }); }
			finally { await response.dispose(); }
		});
		const compiled = await compileNativeImageHandoffScript('lightscaper-opfs-cross-worker-read.js',
			fileURLToPath(new URL('../helpers/lightscaper-opfs-cross-worker-read-native.ts', import.meta.url)));
		if (compiled.assets.length) throw new Error('The native storage fixture must not add companion assets.');
		await page.route('**' + PROGRAM, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
		const origins = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS);
		const origin = new URL(origins.framescaper);
		if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Expected the maintained Frame loopback origin.');
		await page.route('**/__lightscaper_opfs_cross_worker_read.html', async route => {
			const response = await route.fetch({ url: new URL('/embed/en/', origin).href });
			const headers = response.headers(); delete headers['content-length']; delete headers['content-encoding'];
			headers['content-type'] = 'text/html; charset=utf-8';
			try { await route.fulfill({ status: 200, headers, body: '<!doctype html><html lang="en"><title>Native cross-worker resource read</title></html>' }); }
			finally { await response.dispose(); }
		});
		await page.goto(new URL('/__lightscaper_opfs_cross_worker_read.html', origin).href);
		packet = await page.evaluate(async () => {
			if (!isSecureContext || !crossOriginIsolated) throw new Error('The actual isolated loopback native environment is required.');
			return (await import('/__lightscaper_opfs_cross_worker_read.js')).runLightscaperOpfsCrossWorkerReadNative();
		});
		expect(nativeEnvironment).toHaveLength(2);
	} catch (error) { primary = error; }
	finally {
		try { await page.close(); } catch (error) { cleanupError = error; }
		let timer;
		try {
			await Promise.race([Promise.all(workers.map(row => row.closed)),
				new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native worker close event did not join')), 10000); })]);
		} catch (error) { cleanupError ??= error; }
		finally { clearTimeout(timer); page.off('worker', onWorker); }
		const result = { packet, nativeEnvironment, workers: workers.map(({ url, closeObserved }) => ({ url, closeObserved })),
			primaryError: primary ? String(primary) : null, cleanupError: cleanupError ? String(cleanupError) : null };
		const body = JSON.stringify(result, null, 2);
		await info.attach('native-cross-worker-read', { body: Buffer.from(body), contentType: 'application/json' });
	}
	if (primary) throw primary;
	if (cleanupError) throw cleanupError;
	expect(workers).toHaveLength(2);
	expect(workers.every(row => row.closeObserved)).toBe(true);
	expect(packet.setupError).toBeUndefined();
	expect(packet.directorySameHandleSentToBoth).toBe(true);
	expect(packet.snapshotsRequestedPerClient).toBe(8);
	expect(packet.holderUsed).toBe(false);
	expect(packet.observations).toHaveLength(4);
	for (const row of packet.observations) {
		expect(row.status).toBe('fulfilled'); expect(row.exactBytes).toBe(true); expect(row.bytes).toEqual(EXPECTED);
	}
	expect(packet.batch).toHaveLength(16);
	for (const client of [0, 1]) expect(packet.batch.filter(row => row.client === client)).toHaveLength(8);
	for (const row of packet.batch) {
		expect(row.status, JSON.stringify(row)).toBe('fulfilled');
		expect(row.exactBytes).toBe(true); expect(row.bytes).toEqual(EXPECTED);
	}
	expect(packet.cleanup.finalBytes).toEqual(EXPECTED);
	expect(packet.cleanup.setupWriterClosedBeforeReads).toBe(true);
	expect(packet.cleanup.clientsClosed).toBe(2);
	expect(packet.cleanup.privateDirectoryRemoved).toBe(true);
});
