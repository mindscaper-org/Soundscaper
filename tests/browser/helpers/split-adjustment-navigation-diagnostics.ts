/* SPDX-License-Identifier: AGPL-3.0-only */

import { performance } from 'node:perf_hooks';
import type { Frame, Page, Request, Response, TestInfo } from '@playwright/test';

type Primitive = string | number | boolean | null;
type Fields = Record<string, Primitive>;
type AttachmentInfo = Pick<TestInfo, 'duration' | 'timeout' | 'status' | 'expectedStatus'>;
const owners = new WeakMap<Page, { finish(info: AttachmentInfo): string }>();

/** Passive evidence for the split-adjustment case's initial main-frame navigation. */
export function installSplitAdjustmentNavigationDiagnostics(page: Page): void {
	const installedMonotonicMs = performance.now(), installedWallTime = new Date().toISOString();
	const browser = page.context().browser();
	const events: Fields[] = [], disposers: (() => void)[] = [];
	const requestIds = new WeakMap<Request, number>();
	let nextRequestId = 0, seenEvents = 0, capturedEvents = 0, collectionErrors = 0;
	const short = (value: string, limit = 2_048) => value.slice(0, limit);
	const snapshot = (): Fields => ({ url: short(page.url()), isClosed: page.isClosed(),
		isConnected: browser?.isConnected() ?? null });
	const safeSnapshot = (): Fields | null => {
		try { return snapshot(); } catch { collectionErrors++; return null; }
	};
	const initial = safeSnapshot();
	const record = (kind: string, fields: () => Fields) => {
		seenEvents++;
		try {
			const monotonicMs = performance.now();
			events.push({ sequence: seenEvents, kind, monotonicMs,
				elapsedSinceInstallationMs: monotonicMs - installedMonotonicMs, ...fields() });
			capturedEvents++;
			if (events.length > 64) events.shift();
		} catch { collectionErrors++; }
	};
	const navigation = (request: Request, kind: string, details: () => Fields = () => ({})) => {
		try {
			if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
			record(kind, () => {
				if (!requestIds.has(request)) requestIds.set(request, ++nextRequestId);
				return { requestId: requestIds.get(request)!, url: short(request.url()),
					method: short(request.method(), 24), ...details() };
			});
		} catch { collectionErrors++; }
	};
	const onRequest = (request: Request) => navigation(request, 'request');
	const onResponse = (response: Response) => {
		try { navigation(response.request(), 'response', () => ({ status: response.status(),
			statusText: short(response.statusText(), 160) })); }
		catch { collectionErrors++; }
	};
	const onFinished = (request: Request) => navigation(request, 'requestfinished');
	const onFailed = (request: Request) => navigation(request, 'requestfailed',
		() => ({ error: short(request.failure()?.errorText ?? '', 512) }));
	const onFrame = (frame: Frame) => {
		try { if (frame === page.mainFrame()) record('framenavigated', () => ({ url: short(frame.url()) })); }
		catch { collectionErrors++; }
	};
	const onDomContentLoaded = () => record('domcontentloaded', snapshot);
	const onLoad = () => record('load', snapshot);
	const onCrash = () => record('crash', snapshot);
	const onClose = () => record('close', snapshot);
	const onDisconnected = () => record('browser-disconnected', snapshot);
	page.on('request', onRequest); disposers.push(() => { page.off('request', onRequest); });
	page.on('response', onResponse); disposers.push(() => { page.off('response', onResponse); });
	page.on('requestfinished', onFinished); disposers.push(() => { page.off('requestfinished', onFinished); });
	page.on('requestfailed', onFailed); disposers.push(() => { page.off('requestfailed', onFailed); });
	page.on('framenavigated', onFrame); disposers.push(() => { page.off('framenavigated', onFrame); });
	page.on('domcontentloaded', onDomContentLoaded); disposers.push(() => { page.off('domcontentloaded', onDomContentLoaded); });
	page.on('load', onLoad); disposers.push(() => { page.off('load', onLoad); });
	page.on('crash', onCrash); disposers.push(() => { page.off('crash', onCrash); });
	page.on('close', onClose); disposers.push(() => { page.off('close', onClose); });
	if (browser) {
		browser.on('disconnected', onDisconnected);
		disposers.push(() => { browser.off('disconnected', onDisconnected); });
	}
	owners.set(page, { finish(info) {
		const finalMonotonicMs = performance.now(), finalWallTime = new Date().toISOString();
		const final = safeSnapshot();
		for (const dispose of disposers) {
			try { dispose(); } catch { collectionErrors++; }
		}
		const retained = [...events];
		for (;;) {
			const droppedEvents = capturedEvents - retained.length;
			try {
				const body = JSON.stringify({ available: true, installedMonotonicMs, installedWallTime,
					finalMonotonicMs, finalWallTime, observedDurationMs: finalMonotonicMs - installedMonotonicMs,
					testInfoAtAttachment: { durationMs: info.duration, timeoutMs: info.timeout,
						status: info.status ?? null, expectedStatus: info.expectedStatus },
					initial, final, seenEvents, capturedEvents, retainedEvents: retained.length, droppedEvents,
					uncollectedEvents: seenEvents - capturedEvents, ringDroppedEvents: capturedEvents - events.length,
					payloadDroppedEvents: events.length - retained.length, collectionErrors,
					capacity: 64, byteLimit: 32_768, truncated: droppedEvents > 0 || collectionErrors > 0, events: retained,
					limits: 'Observation starts at installation and stops before attachment. The test timeout is a whole-test budget, not a measured goto duration. Final URL is not proof of its earlier value.' });
				if (Buffer.byteLength(body) <= 32_768) return body;
			} catch { collectionErrors++; break; }
			if (!retained.length) break;
			retained.shift();
		}
		return JSON.stringify({ available: false, reason: 'Navigation diagnostic serialization or byte bound refused.',
			seenEvents, capturedEvents, retainedEvents: 0, droppedEvents: capturedEvents,
			collectionErrors, capacity: 64, byteLimit: 32_768, truncated: true });
	} });
}

/** Attach on both outcomes; all state reads are synchronous Node-side public APIs. */
export async function attachSplitAdjustmentNavigationDiagnostics(page: Page, testInfo: TestInfo): Promise<void> {
	const owner = owners.get(page);
	owners.delete(page);
	let body: string;
	try { body = owner?.finish(testInfo) ?? JSON.stringify({ available: false,
		reason: 'No navigation recorder was installed.', droppedEvents: null, truncated: true }); }
	catch (error) { body = JSON.stringify({ available: false, error: String(error).slice(0, 512),
		droppedEvents: null, truncated: true }); }
	try { await testInfo.attach('split-adjustment-navigation-history', { body, contentType: 'application/json' }); }
	catch (error) { testInfo.annotations.push({ type: 'diagnostic-unavailable', description: String(error).slice(0, 512) }); }
}
