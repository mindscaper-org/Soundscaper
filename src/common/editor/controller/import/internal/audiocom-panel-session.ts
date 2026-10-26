/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AudiocomAccount, AudiocomPanelSession, AudiocomPanelSessionOptions,
	AudiocomPanelSnapshot, AudiocomPreviewAudio,
} from '../audiocom-panel-session.ts';
import { onlineMediaFailure } from '../../../online-media-failure.ts';
import { AudiocomApiError, createAudiocomApiClient } from './audiocom-api-client.ts';
import { createAudiocomUploadQueue } from './audiocom-upload-queue.ts';
import { prepareAudiocomPreview } from './audiocom-original-preview.ts';

const emptySearch = () => ({ query: '', page: 1, hasNext: false, results: [], status: 'idle' as const });

/** Account, search and preview generations prevent old asynchronous work crossing sessions. */
export function createPanelSession(options: AudiocomPanelSessionOptions): AudiocomPanelSession {
	const client = options.client ?? createAudiocomApiClient({ apiOrigin: options.apiOrigin });
	const now = options.now ?? Date.now;
	const wait = options.wait ?? waitForPoll;
	const listeners = new Set<() => void>();
	let disposed = false;
	let active = true;
	let gain = 1;
	let outputDeviceId = '';
	let accountGeneration = 0;
	let initialized = false;
	let initialization: Promise<void> | null = null;
	let accountAbort: AbortController | null = null;
	let searchAbort: AbortController | null = null;
	let previewAudio: AudiocomPreviewAudio | null = null;
	let previewCleanup: (() => void) | null = null;
	let previewAbort: AbortController | null = null;
	let previewSourceCleanup: (() => void) | null = null;
	let snapshot: AudiocomPanelSnapshot = Object.freeze({
		auth: { status: 'loading' as const }, search: emptySearch(), uploadQueue: { items: [], active: false }, previewingId: null,
	});
	const emit = (patch: Partial<AudiocomPanelSnapshot>): void => {
		if (disposed) return;
		snapshot = Object.freeze({ ...snapshot, ...patch });
		for (const listener of listeners) listener();
	};
	const connected = (): boolean => snapshot.auth.status === 'connected' && !disposed;
	const queue = createAudiocomUploadQueue(client, connected, () => emit({ uploadQueue: queue.snapshot() }), expire);
	const stopPreview = (): void => {
		previewAbort?.abort(); previewAbort = null;
		const audio = previewAudio;
		previewAudio = null;
		previewCleanup?.(); previewCleanup = null;
		if (audio) { audio.pause(); audio.src = ''; audio.load(); }
		previewSourceCleanup?.(); previewSourceCleanup = null;
		if (snapshot.previewingId !== null) emit({ previewingId: null });
	};
	function expire(error: unknown): void {
		if (!(error instanceof AudiocomApiError) || error.status !== 401 || disposed) return;
		++accountGeneration;
		accountAbort?.abort(); searchAbort?.abort(); stopPreview(); queue.reset();
		emit({ auth: { status: 'disconnected', requestFailure: onlineMediaFailure('connection-expired', error), errorMessage: error.message }, search: emptySearch() });
	}
	const applyAccount = (account: AudiocomAccount): void => {
		emit({ auth: { status: account.connected ? 'connected' : 'disconnected', ...(account.user ? { user: account.user } : {}) } });
	};
	const initialize = (): Promise<void> => {
		if (initialized || disposed) return initialization ?? Promise.resolve();
		initialized = true;
		const generation = accountGeneration;
		const abort = new AbortController(); accountAbort = abort;
		initialization = client.session(abort.signal).then(account => {
			if (!disposed && generation === accountGeneration) applyAccount(account);
		}).catch((error: unknown) => {
			if (!disposed && generation === accountGeneration && !abort.signal.aborted) {
				emit({ auth: { status: 'disconnected', requestFailure: onlineMediaFailure('authentication', error), errorMessage: message(error) } });
			}
		});
		return initialization;
	};
	return {
		getSnapshot: () => snapshot,
		subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		initialize,
		async connect(): Promise<void> {
			if (disposed || snapshot.auth.status === 'connecting' || connected()) return;
			let reservation;
			try { reservation = client.reserveAuthorization(); }
			catch (error) { emit({ auth: { status: 'disconnected', requestFailure: onlineMediaFailure('authentication', error), errorMessage: message(error) } }); return; }
			const generation = ++accountGeneration;
			accountAbort?.abort();
			const abort = new AbortController(); accountAbort = abort;
			emit({ auth: { status: 'connecting' } });
			try {
				const attempt = await client.startOAuth(abort.signal);
				if (disposed || generation !== accountGeneration || abort.signal.aborted) { reservation.close(); return; }
				await reservation.open(attempt.authorizeUrl);
				const expiresAt = Math.min(Date.parse(attempt.expiresAt), now() + 10 * 60_000);
				while (!abort.signal.aborted && !disposed && generation === accountGeneration && now() < expiresAt) {
					const account = await client.pollOAuth(attempt.attemptId, attempt.handoffToken, abort.signal);
					if (disposed || generation !== accountGeneration || abort.signal.aborted) return;
					if (account?.connected) { applyAccount(account); return; }
					await wait(1_000, abort.signal);
				}
				if (!abort.signal.aborted) throw new Error('The audio.com connection attempt expired.');
			} catch (error) {
				reservation.close();
				if (!disposed && generation === accountGeneration && !abort.signal.aborted) emit({ auth: { status: 'disconnected', requestFailure: onlineMediaFailure('authentication', error), errorMessage: message(error) } });
			}
		},
		async disconnect(): Promise<void> {
			if (disposed) return;
			const previousAuth = snapshot.auth;
			const generation = ++accountGeneration;
			accountAbort?.abort(); searchAbort?.abort(); stopPreview(); queue.reset();
			emit({ auth: { status: 'loading' }, search: emptySearch() });
			try {
				await client.disconnect();
				if (!disposed && generation === accountGeneration) emit({ auth: { status: 'disconnected' } });
			} catch (error) {
				if (!disposed && generation === accountGeneration) {
					const status = error instanceof AudiocomApiError && error.status === 401 ? 'disconnected' : previousAuth.status;
					emit({ auth: { ...previousAuth, status, requestFailure: onlineMediaFailure('authentication', error), errorMessage: message(error) } });
				}
			}
		},
		async search({ query, page }): Promise<void> {
			if (!connected() || !active) return;
			const normalized = query.trim();
			if (!normalized || normalized.length > 200 || !Number.isSafeInteger(page) || page < 1) return;
			searchAbort?.abort(); stopPreview();
			const abort = new AbortController(); searchAbort = abort;
			const generation = accountGeneration;
			emit({ search: { ...snapshot.search, query: normalized, page, status: 'loading', requestFailure: undefined, errorMessage: undefined } });
			try {
				const result = await client.search({ query: normalized, page }, abort.signal);
				if (disposed || abort.signal.aborted || generation !== accountGeneration || searchAbort !== abort) return;
				stopPreview();
				emit({ search: { ...result, query: normalized, status: 'ready' } });
			} catch (error) {
				if (disposed || abort.signal.aborted || generation !== accountGeneration || searchAbort !== abort) return;
				expire(error);
				if (connected()) emit({ search: { ...snapshot.search, status: 'error', requestFailure: onlineMediaFailure('search', error), errorMessage: message(error) } });
			}
		},
		async preview(id): Promise<void> {
			if (!connected() || !active) return;
			if (snapshot.previewingId === id) { stopPreview(); return; }
			stopPreview();
			const result = snapshot.search.results.find(value => value.id === id);
			if (!result?.previewUrl) return;
			const abort = new AbortController(); previewAbort = abort;
			emit({ previewingId: id, previewFailure: undefined, previewError: undefined });
			let audio: AudiocomPreviewAudio | null = null;
			try {
				const prepared = await (options.preparePreview ?? prepareAudiocomPreview)(result, abort.signal);
				if (previewAbort !== abort || abort.signal.aborted || disposed || !active) { prepared.dispose(); return; }
				previewSourceCleanup = () => prepared.dispose();
				if (prepared.durationSeconds !== undefined) {
					emit({ search: { ...snapshot.search, results: snapshot.search.results.map(value => value.id === id ? { ...value, durationSeconds: prepared.durationSeconds! } : value) } });
				}
				audio = options.createAudio?.() ?? new Audio();
				previewAudio = audio; audio.src = prepared.url; audio.volume = gain;
				const ended = (): void => { if (previewAudio === audio) stopPreview(); };
				const failed = (): void => {
					if (previewAudio !== audio) return;
					stopPreview(); emit({ previewFailure: onlineMediaFailure('preview'), previewError: 'The audio.com preview could not be played.' });
				};
				audio.addEventListener('ended', ended); audio.addEventListener('error', failed);
				previewCleanup = () => { audio?.removeEventListener('ended', ended); audio?.removeEventListener('error', failed); };
				if (audio.setSinkId) await audio.setSinkId(outputDeviceId);
				if (previewAudio !== audio || disposed || !active) return;
				await audio.play();
				if (previewAudio !== audio) { audio.pause(); audio.src = ''; audio.load(); }
			} catch (error) {
				if (previewAbort === abort && !abort.signal.aborted) {
					stopPreview(); expire(error);
					if (connected()) emit({ previewFailure: onlineMediaFailure('preview', error), previewError: message(error) });
				}
			}
		},
		stopPreview,
		enqueueFiles: files => queue.enqueueFiles(files), publish: (id, draft) => queue.publish(id, draft),
		retry: id => queue.retry(id), cancel: id => queue.cancel(id), remove: id => queue.remove(id),
		setActive(value): void {
			active = value;
			if (!active) {
				searchAbort?.abort(); stopPreview();
				if (snapshot.search.status === 'loading') emit({ search: { ...snapshot.search, status: 'idle' } });
			}
		},
		setListeningPreferences(value, deviceId): void {
			gain = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
			outputDeviceId = deviceId.startsWith('native:') ? '' : deviceId;
			if (previewAudio) {
				previewAudio.volume = gain;
				const audio = previewAudio;
				void audio.setSinkId?.(outputDeviceId).catch(() => { if (previewAudio === audio) stopPreview(); });
			}
		},
		dispose(): void {
			if (disposed) return;
			++accountGeneration; accountAbort?.abort(); searchAbort?.abort(); stopPreview(); queue.dispose();
			disposed = true; listeners.clear();
		},
	};
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'The audio.com request failed.'; }
function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const aborted = (): void => { clearTimeout(timer); reject(signal.reason as unknown); };
		const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, milliseconds);
		signal.addEventListener('abort', aborted, { once: true });
	});
}
