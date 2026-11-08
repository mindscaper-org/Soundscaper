/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';
import { captureOwnedBrowserProcessV1, killAndJoinOwnedBrowserProcessV1 } from './helpers/lightscaper-owned-browser-process.ts';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import type { RasterCrashPrepared, RasterCrashSnapshot, RasterCrashRecovery } from '../helpers/lightscaper-raster-export-process-crash-native-current.ts';

const PROGRAM = '/__raster_export_process_crash_current.js', HOST = '/__raster_export_process_crash_current.html';
const NAMES = ['01-Crash first.png', '02-Crash second.png'] as const;
const ORIGINALS = [[255, 255, 255, 255], [255, 0, 0, 255]].map(color => png(color));
const OUTPUTS = [[188, 188, 188, 255, 188, 188, 188, 255], [188, 0, 0, 255, 188, 0, 0, 255]];

test('Current PNG export survives an actual owned browser SIGKILL with one retained ACK and reviewed lost-ACK recovery', async ({ playwright, browserName }, testInfo) => {
	test.skip(browserName !== 'chromium' || process.platform !== 'linux', 'This finite process witness uses owned Chromium/Linux processes and an isolated persistent profile.');
	test.setTimeout(120_000);
	const program = await compileNativeImageHandoffScript('raster-export-process-crash-current.js', fileURLToPath(new URL('../helpers/lightscaper-raster-export-process-crash-native-current.ts', import.meta.url)));
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-export-crash-')), profile = join(directory, 'profile'), destination = join(directory, 'png-output');
	const productUrl = resolveBrowserProductTestUrl('/lightscaper/en/');
	const origin = productUrl.startsWith('http:') ? new URL(productUrl).origin : browserProductSiteForBuild('lightscaper').origin;
	const executablePath = playwright.chromium.executablePath();
	let context: BrowserContext | null = null;
	let release: () => void = () => undefined;
	const pending = new Set<Promise<unknown>>(), writes: Array<{ phase: string; name: string; sha256: string; bytes: number }> = [];
	const held = new Promise<void>(resolve => { release = resolve; });
	let prepared: RasterCrashPrepared | undefined, prefix: RasterCrashSnapshot | undefined;
	let failed = false, primary: unknown;
	const cleanup: unknown[] = [];
	try {
		await mkdir(profile); await mkdir(destination);
		context = await launch(); let page = await host(context);
		const identity = await captureOwnedBrowserProcessV1({ browserName: 'chromium', executablePath, profilePath: profile });
		prepared = await page.evaluate(async ({ path, originals }) => (await import(new URL(path, location.href).href)).prepareRasterExportCrashCurrent(originals),
			{ path: PROGRAM, originals: ORIGINALS.map(bytes => [...bytes]) }) as RasterCrashPrepared;
		expect(prepared.before.photos.map(row => row.bytes)).toEqual(ORIGINALS.map(bytes => [...bytes]));
		for (const [index, row] of prepared.before.photos.entries()) {
			expect(row.photo.original.contentSha256).toBe(sha(ORIGINALS[index]!)); expect(row.photo.revision).toBe(1);
			const version = row.photo.versions.find(version => version.id === row.photo.activeVersionId); expect(version).toBeDefined();
			expect(version!.develop).toMatchObject({ processVersion: 3, repairs: { schemaVersion: 1, spots: [] },
				effects: [{ id: 'crash-exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }] });
		}
		await expect.poll(() => writes.length, { timeout: 30_000, message: 'both actual PNG writes must reach fsync before process death' }).toBe(2);
		prefix = await snapshot(page, prepared.ids);
		expect(prefix.stable).toEqual(prepared.before.stable); expect(prefix.photos).toEqual(prepared.before.photos);
		expect(prefix.journal?.members.map(member => member.state)).toEqual(['committed', 'started']);
		const firstAck = prefix.journal!.members[0]!.delivery; expect(firstAck).toMatchObject({ status: 'download-started', method: 'download', fileName: NAMES[0] });
		expect(firstAck!.size).toBe(writes[0]!.bytes);
		expect(prefix.journal!.members[1]!.delivery).toBeNull();
		const live = await page.evaluate(async path => (await import(new URL(path, location.href).href)).readRasterExportCrashLiveCurrent(), PROGRAM);
		expect(live).toEqual({ pending: true, signalAborted: false, closeCalls: 0, destinationCalls: 2 });
		expect(writes.map(write => [write.phase, write.name])).toEqual([['initial', NAMES[0]], ['initial', NAMES[1]]]);
		for (let index = 0; index < 2; index++) assertPng(await readFile(join(destination, NAMES[index]!)), OUTPUTS[index]!);
		const browser = context.browser(); expect(browser).not.toBeNull();
		await killAndJoinOwnedBrowserProcessV1(identity, browser!); expect(browser!.isConnected()).toBe(false); context = null;
		// Only after genuine process death may the Node test sink release its
		// withheld response. No browser consumer can acknowledge it now.
		release(); await Promise.allSettled([...pending]); expect(pending.size).toBe(0);

		context = await launch(); page = await host(context);
		const reopened = await snapshot(page, prepared.ids); expect(reopened).toEqual(prefix);
		const recovered = await page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).inspectRasterExportRecoveryCurrent(ids),
			{ path: PROGRAM, ids: prepared.ids }) as RasterCrashRecovery;
		expect(recovered.dispositions).toEqual(['already-committed', 'needs-review']); expect(recovered.unreviewedRefused).toBe(true);
		expect(recovered.snapshot).toEqual(prefix); expect(writes).toHaveLength(2);
		const unfinished = prefix.journal!.members[1]!.jobId;
		const resumed = await page.evaluate(async ({ path, ids, reviewed }) => (await import(new URL(path, location.href).href)).recoverRasterExportCurrent(ids, reviewed),
			{ path: PROGRAM, ids: prepared.ids, reviewed: [unfinished] }) as RasterCrashSnapshot;
		expect(resumed.journal?.members.map(member => member.state)).toEqual(['committed', 'committed']);
		expect(resumed.journal!.members[0]!.delivery).toEqual(firstAck);
		expect(resumed.journal!.members[1]!.delivery?.size).toBe(writes[2]!.bytes);
		expect(resumed.stable).toEqual(prepared.before.stable); expect(resumed.photos).toEqual(prepared.before.photos);
		expect(writes.map(write => [write.phase, write.name])).toEqual([['initial', NAMES[0]], ['initial', NAMES[1]], ['reviewed', NAMES[1]]]);
		for (let index = 0; index < 2; index++) assertPng(await readFile(join(destination, NAMES[index]!)), OUTPUTS[index]!);
		expect(sha(await readFile(join(destination, NAMES[0])))).toBe(writes[0]!.sha256);
		expect(writes[2]!.sha256).toBe(writes[1]!.sha256);
		await context.close(); context = null;
		context = await launch(); page = await host(context);
		expect(await snapshot(page, prepared.ids)).toEqual(resumed);
		const final = await page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).inspectRasterExportRecoveryCurrent(ids),
			{ path: PROGRAM, ids: prepared.ids }) as RasterCrashRecovery;
		expect(final.dispositions).toEqual(['already-committed', 'already-committed']); expect(final.snapshot).toEqual(resumed); expect(writes).toHaveLength(3);
		await testInfo.attach('export-process-crash.json', { body: JSON.stringify({ identity, prepared, prefix, resumed, final, writes }), contentType: 'application/json' });
	} catch (error) { failed = true; primary = error; }
	finally {
		release(); await Promise.allSettled([...pending]);
		if (context?.browser()?.isConnected()) {
			const page = context.pages()[0];
			if (page) try { await page.evaluate(async path => (await import(new URL(path, location.href).href)).retireRasterExportCrashCurrent(), PROGRAM); } catch (error) { cleanup.push(error); }
			try { await context.close(); } catch (error) { cleanup.push(error); }
		}
		try { await rm(directory, { recursive: true, force: true }); } catch (error) { cleanup.push(error); }
	}
	if (failed && !cleanup.length) throw primary;
	if (failed || cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Export crash qualification and joined cleanup failed.', failed ? { cause: primary } : undefined);

	function launch() { return playwright.chromium.launchPersistentContext(profile, { executablePath, headless: true, serviceWorkers: 'block' }); }
	async function host(owner: BrowserContext): Promise<Page> {
		const page = owner.pages()[0] ?? await owner.newPage(); await installNativeOpfsWorkerCompanion(page);
		await page.exposeFunction('__rasterCrashPngSink', (phase: unknown, name: unknown, bytes: unknown) => {
			const work = save(phase, name, bytes); pending.add(work);
			return work.finally(() => { pending.delete(work); });
		});
		await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
		for (const asset of program.assets) await page.route(`**${asset.pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: asset.source }));
		await page.route(`**${HOST}`, async route => {
			const response = await route.fetch({ url: `${origin}/en/` }), headers = response.headers();
			delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/html';
			try { await route.fulfill({ status: 200, headers, body: '<!doctype html><title>Export crash qualification</title><main>Export crash qualification</main>' }); }
			finally { await response.dispose(); }
		});
		await page.goto(`${origin}${HOST}`); await expect(page.getByRole('main')).toHaveText('Export crash qualification');
		expect(await page.evaluate(() => isSecureContext && crossOriginIsolated)).toBe(true); return page;
	}
	/** An injected bounded destination edge, not a browser picker or a Saved
	 * receipt. Real PNG bytes reach fsync before a legal download ACK returns. */
	async function save(phase: unknown, name: unknown, values: unknown) {
		if ((phase !== 'initial' && phase !== 'reviewed') || typeof name !== 'string' || !NAMES.some(allowed => allowed === name)
			|| !Array.isArray(values) || values.length < 1 || values.length > 65_536
			|| values.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255)) throw new TypeError('PNG sink refuses foreign paths or oversized/nonbyte payloads.');
		const index = NAMES.findIndex(allowed => allowed === name), bytes = Buffer.from(values as number[]); assertPng(bytes, OUTPUTS[index]!);
		if (phase === 'initial' && name !== NAMES[writes.length] || phase === 'reviewed' && (index !== 1 || writes.some(write => write.phase === 'reviewed'))) throw new TypeError('PNG sink refuses repeated or unselected delivery.');
		const file = await open(join(destination, name), phase === 'initial' ? 'wx' : 'w');
		try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
		writes.push({ phase, name, sha256: sha(bytes), bytes: bytes.length });
		if (phase === 'initial' && index === 1) await held;
		return { method: 'download' as const, fileName: name, size: bytes.length };
	}
});

function snapshot(page: Page, ids: readonly string[]): Promise<RasterCrashSnapshot> {
	return page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).readRasterExportCrashSnapshotCurrent(ids), { path: PROGRAM, ids });
}
function png(color: number[]): Buffer {
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
		pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([0, ...color, ...color]))), pngChunk('IEND', Buffer.alloc(0))]);
}
function assertPng(bytes: Buffer, pixels: readonly number[]): void {
	expect(bytes.length).toBeGreaterThanOrEqual(45); expect(bytes.length).toBeLessThanOrEqual(65_536);
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); expect([...bytes.subarray(16, 29)]).toEqual([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
	const chunks: Buffer[] = []; let ended = false;
	for (let at = 8; at < bytes.length;) {
		expect(at + 12).toBeLessThanOrEqual(bytes.length);
		const size = bytes.readUInt32BE(at), end = at + size + 12; expect(end).toBeLessThanOrEqual(bytes.length);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(at + 4, end - 4)));
		const type = bytes.toString('ascii', at + 4, at + 8); if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, end - 4));
		if (type === 'IEND') { expect(end).toBe(bytes.length); ended = true; } at = end;
	}
	expect(ended).toBe(true); expect([...inflateSync(Buffer.concat(chunks), { maxOutputLength: 9 })]).toEqual([0, ...pixels]);
}
function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
