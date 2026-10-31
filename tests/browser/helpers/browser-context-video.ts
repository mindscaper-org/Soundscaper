/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserContext, BrowserContextOptions, Page, PlaywrightWorkerOptions, TestInfo } from '@playwright/test';
import { rm } from 'node:fs/promises';

type VideoOptions = PlaywrightWorkerOptions['video'];
type SaveOutcome = Readonly<{ okay: true }> | Readonly<{ okay: false; error: unknown }>;
interface SavedVideo { readonly path: string; readonly result: Promise<SaveOutcome> }

// Unknown context/browser retirement keeps the actual outstanding artifact owner.
const unretiredRecordings = new Set<object>();

/** Public video APIs only; Playwright Test continues to own traces/screenshots. */
export function createContextVideo(video: VideoOptions, testInfo: TestInfo, contextOrdinal = 0) {
	const configuredMode = typeof video === 'string' ? video : video.mode;
	const mode = configuredMode === 'retry-with-video' ? 'on-first-retry' : configuredMode;
	const capture = mode === 'on' || mode === 'retain-on-failure' || mode === 'retain-on-failure-and-retries'
		|| (mode === 'on-first-retry' && testInfo.retry === 1) || (mode === 'on-all-retries' && testInfo.retry > 0)
		|| (mode === 'retain-on-first-failure' && testInfo.retry === 0);
	const directory = capture ? testInfo.outputPath(`context-video-source${contextOrdinal ? `-${contextOrdinal}` : ''}`) : undefined;
	const recordings = new Map<Page, SavedVideo>();
	let subject: BrowserContext | undefined;
	let finishing: Promise<void> | undefined;
	const watch = (page: Page) => {
		if (!capture || recordings.has(page)) return;
		const recording = page.video();
		if (!recording) return;
		const ordinal = recordings.size;
		const path = testInfo.outputPath(`video${contextOrdinal ? `-context-${contextOrdinal}` : ''}${ordinal ? `-${ordinal}` : ''}.webm`);
		let result: Promise<SaveOutcome>;
		try {
			// Arm the actual artifact while its channel is live. Saving waits for
			// recording completion, so never await it before page/context close.
			result = recording.saveAs(path).then<SaveOutcome, SaveOutcome>(
				() => ({ okay: true }), (error: unknown) => ({ okay: false, error }));
		} catch (error) { result = Promise.resolve({ okay: false, error }); }
		recordings.set(page, { path, result });
	};
	const options: BrowserContextOptions = {};
	if (directory) {
		if (typeof video !== 'string' && video.show?.test) {
			throw new Error('The isolated context fixture does not implement video.show.test overlays; no private Playwright hooks are used.');
		}
		options.recordVideo = { dir: directory,
			...(typeof video === 'string' || !video.size ? {} : { size: video.size }),
			...(typeof video === 'string' || !video.show?.actions ? {} : { showActions: video.show.actions }) };
	}
	const finish = async (retired: boolean, teardownFailed: boolean) => {
		subject?.off('page', watch);
		if (!directory) return;
		if (!retired) {
			unretiredRecordings.add(Object.freeze({ subject, recordings, directory }));
			return;
		}
		const saves = [...recordings.values()];
		const outcomes = await Promise.all(saves.map(save => save.result));
		const failures: unknown[] = [];
		for (const outcome of outcomes) if (!outcome.okay) failures.push(outcome.error);
		const failed = teardownFailed || failures.length > 0 || testInfo.status !== testInfo.expectedStatus;
		const preserve = mode === 'on' || mode === 'on-first-retry' || mode === 'on-all-retries'
			|| ((mode === 'retain-on-failure' || mode === 'retain-on-first-failure') && failed)
			|| (mode === 'retain-on-failure-and-retries' && (failed || testInfo.retry > 0));
		for (let index = 0; index < saves.length; index += 1) {
			if (!outcomes[index].okay) continue;
			try {
				if (preserve) await testInfo.attach('video', { path: saves[index].path, contentType: 'video/webm' });
				else await rm(saves[index].path, { force: true });
			} catch (error) { failures.push(error); }
		}
		// Failed saves/attachments keep both source and destination evidence.
		if (!failures.length) {
			try { await rm(directory, { recursive: true, force: true }); }
			catch (error) { failures.push(error); }
		}
		if (failures.length > 1) throw new AggregateError(failures, 'Video capture and artifact retirement failed.', { cause: failures[0] });
		if (failures.length) throw failures[0];
		recordings.clear();
		subject = undefined;
	};
	return Object.freeze({
		options,
		attach(context: BrowserContext) {
			if (!capture) return;
			subject = context;
			context.on('page', watch);
			for (const page of context.pages()) watch(page);
		},
		finish(retired: boolean, teardownFailed = false) {
			finishing ??= finish(retired, teardownFailed);
			return finishing;
		},
	});
}
