/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Resumable, digest-verified downloads for optional assistance models.
 *
 * Downloads are never implicit: a caller invokes this for one artifact the
 * user asked for, and nothing here runs at startup or on a timer. Bytes land
 * in a deterministic partial file so an interrupted transfer resumes instead
 * of restarting, and the store re-verifies the completed file against its
 * recorded length and digest before publishing it, so a truncated or tampered
 * transfer is discarded rather than installed.
 */

import { lstat, open, rm } from 'node:fs/promises';

import type { FileLocalModelStore, LocalModelArtifact } from './local-model-store.ts';
import {
	LocalModelConnectionError, recoverLocalModelDownload,
	type LocalModelDownloadConnection, type LocalModelDownloadRecoveryOptions,
} from './local-model-download-recovery.ts';

/** Refuses a body that claims more than this multiple of the recorded length. */
const MAX_OVERSHOOT_BYTES = 1024;
const MAX_REDIRECTS = 5;

export interface LocalModelDownloadProgress {
	readonly completedBytes: number;
	readonly totalBytes: number;
}

export interface LocalModelDownloadRequest {
	readonly store: FileLocalModelStore;
	readonly artifact: LocalModelArtifact;
	readonly url: string;
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: LocalModelDownloadProgress) => void;
	readonly recovery?: LocalModelDownloadRecoveryOptions;
}

export interface LocalModelDownloadResult {
	readonly blobPath: string;
	readonly resumedFromBytes: number;
	readonly transferredBytes: number;
}

function assertDownloadUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new TypeError('A local model download URL must be absolute.', { cause: error });
	}
	if (url.protocol !== 'https:') {
		throw new TypeError('A local model download URL must use https.');
	}
	if (url.username !== '' || url.password !== '' || url.hash !== '') {
		throw new TypeError('A local model download URL must not carry credentials or a fragment.');
	}
	return url;
}

async function fetchModelResponse(
	target: URL,
	headers: Readonly<Record<string, string>>,
	connection: LocalModelDownloadConnection,
	fetchImpl: typeof fetch,
): Promise<Response> {
	for (let redirects = 0; ; redirects += 1) {
		const pending = Promise.resolve().then(() => fetchImpl(target, { headers, signal: connection.signal, redirect: 'manual' }));
		void pending.then(response => {
			if (connection.signal.aborted) cancelBody(response.body);
		}, () => undefined);
		const response = await connection.read(() => pending);
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;
		cancelBody(response.body);
		if (redirects >= MAX_REDIRECTS) {
			throw new Error('A local model download exceeded the redirect limit.');
		}
		const location = response.headers.get('location');
		if (location === null) {
			throw new Error('A local model download redirect has no location.');
		}
		let next: URL;
		try { next = new URL(location, target); }
		catch (error) { throw new TypeError('A local model download redirect URL is invalid.', { cause: error }); }
		target = assertDownloadUrl(next.href);
	}
}

async function existingPartialBytes(path: string, limit: number): Promise<number> {
	try {
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error('A local model partial must be a regular non-symbolic file.');
		}
		// A partial longer than the artifact cannot be a prefix of it.
		return metadata.size > limit ? 0 : metadata.size;
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error
			&& String((error as { code?: unknown }).code) === 'ENOENT') return 0;
		throw error;
	}
}

async function publishedPathExists(store: FileLocalModelStore, sha256: string): Promise<boolean> {
	try {
		await lstat(store.blobPath(sha256));
		return true;
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error
			&& String((error as { code?: unknown }).code) === 'ENOENT') return false;
		throw error;
	}
}

/**
 * Fetches one artifact into the store. Returns the published blob path, or
 * short-circuits when the store already holds the artifact.
 */
export async function downloadLocalModelArtifact(
	request: LocalModelDownloadRequest,
): Promise<LocalModelDownloadResult> {
	const { store, artifact, url, fetchImpl = fetch, signal, onProgress } = request;
	const target = assertDownloadUrl(url);
	signal?.throwIfAborted();

	if (await publishedPathExists(store, artifact.sha256)) {
		if (!await store.verifyArtifact(artifact)) {
			throw new Error('A published artifact failed its integrity check for this local model.');
		}
		return Object.freeze({
			blobPath: store.blobPath(artifact.sha256),
			resumedFromBytes: artifact.byteLength,
			transferredBytes: 0,
		});
	}

	const partialPath = await store.partialPath(artifact.sha256);
	let transferredBytes = 0;
	const downloaded = await recoverLocalModelDownload(async connection => {
		let resumedFromBytes = await existingPartialBytes(partialPath, artifact.byteLength);
		if (resumedFromBytes === artifact.byteLength) {
			// A lost final response must not download an already complete, authentic body again.
			connection.signal.throwIfAborted();
			return { resumedFromBytes, blobPath: await store.publishBlob(partialPath, artifact) };
		}

		const headers: Record<string, string> = { accept: 'application/octet-stream' };
		if (resumedFromBytes > 0) headers.range = `bytes=${resumedFromBytes}-`;

		const response = await fetchModelResponse(target, headers, connection, fetchImpl);
		if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
			cancelBody(response.body);
			throw new LocalModelConnectionError(`A local model download failed with temporary status ${response.status}.`);
		}
		if (resumedFromBytes > 0 && response.status === 200) {
			// The server ignored the range; restart cleanly rather than splicing.
			await rm(partialPath, { force: true });
			resumedFromBytes = 0;
		} else if (resumedFromBytes > 0 && response.status !== 206) {
			cancelBody(response.body);
			throw new Error(`A local model download failed with status ${response.status}.`);
		} else if (resumedFromBytes === 0 && response.status !== 200) {
			cancelBody(response.body);
			throw new Error(`A local model download failed with status ${response.status}.`);
		}

		const remaining = artifact.byteLength - resumedFromBytes;
		const declared = Number(response.headers?.get?.('content-length') ?? Number.NaN);
		if (Number.isFinite(declared) && declared > remaining + MAX_OVERSHOOT_BYTES) {
			cancelBody(response.body);
			throw new RangeError('A local model download declares more bytes than the artifact records.');
		}
		if (!response.body) {
			throw new Error('A local model download returned no body.');
		}

		let completedBytes = resumedFromBytes;
		const handle = await open(partialPath, resumedFromBytes > 0 ? 'a' : 'w', 0o600).catch((error: unknown) => {
			cancelBody(response.body);
			throw error;
		});
		let iterator: AsyncIterator<Uint8Array> | undefined;
		try {
			iterator = (response.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
			const input = iterator;
			for (;;) {
				const next = await connection.read(() => input.next());
				connection.signal.throwIfAborted();
				if (next.done) break;
				const chunk = next.value;
				if (!(chunk instanceof Uint8Array)) throw new TypeError('A local model download returned non-byte data.');
				completedBytes += chunk.byteLength;
				if (completedBytes > artifact.byteLength) {
					throw new RangeError('A local model download exceeded the recorded artifact length.');
				}
				let offset = 0;
				while (offset < chunk.byteLength) {
					const written = await handle.write(chunk, offset, chunk.byteLength - offset);
					if (written.bytesWritten < 1) throw new Error('The local model download could not write its partial file.');
					offset += written.bytesWritten;
				}
				transferredBytes += chunk.byteLength;
				onProgress?.(Object.freeze({ completedBytes, totalBytes: artifact.byteLength }));
			}
			await handle.sync();
		} finally {
			try { void iterator?.return?.().catch(() => undefined); } catch { /* Retain the transfer failure. */ }
			await handle.close().catch(() => undefined);
		}

		if (completedBytes !== artifact.byteLength) {
			// Keep the partial: a short read is the case resuming exists for.
			throw new LocalModelConnectionError('A local model download ended before the recorded artifact length.');
		}
		return { resumedFromBytes, blobPath: undefined };
	}, signal, request.recovery);

	signal?.throwIfAborted();
	const blobPath = downloaded.blobPath ?? await store.publishBlob(partialPath, artifact);
	return Object.freeze({ blobPath, resumedFromBytes: downloaded.resumedFromBytes, transferredBytes });
}

function cancelBody(body: Response['body']): void {
	try { void body?.cancel?.().catch(() => undefined); }
	catch { /* A locked or already-ended response cannot delay recovery. */ }
}
