/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';

import {
	handleShareTargetSubmission,
	sharedFilesBodyUrl,
	shareTargetFunctionSources,
} from '../scripts/lib/offline-share-target-worker.mjs';
import { collectSharedFiles } from '../src/common/offline/share-target-launch.ts';

const ORIGIN = 'https://soundscaper.org';
type ShareHandler = typeof handleShareTargetSubmission;

function latch(): { ready: Promise<void>; release: () => void } {
	let release = (): void => {};
	const ready = new Promise<void>((resolve) => { release = resolve; });
	return { ready, release };
}

class DelayedShareCache {
	readonly entries = new Map<string, Response>();
	readonly firstBodyStored = latch();
	readonly acknowledgeFirstBody = latch();
	private delayed = false;
	constructor(private readonly failFirstBody: boolean) {}

	async match(url: string): Promise<Response | undefined> {
		return this.entries.get(url)?.clone();
	}

	async put(url: string, response: Response): Promise<void> {
		this.entries.set(url, response.clone());
		if (!this.delayed && url.endsWith('/0')) {
			this.delayed = true;
			this.firstBodyStored.release();
			await this.acknowledgeFirstBody.ready;
			if (this.failFirstBody) throw new Error('The first cache write failed.');
		}
	}

	async delete(url: string): Promise<boolean> {
		return this.entries.delete(url);
	}

	async keys(): Promise<Request[]> {
		return [...this.entries.keys()].map((url) => new Request(`${ORIGIN}${url}`));
	}
}

function request(name: string, contents: string): Request {
	const data = new FormData();
	data.append('media', new File([contents], name, { type: 'audio/wav' }));
	return new Request(`${ORIGIN}/share-target`, { method: 'POST', body: data });
}

async function overlappingShares(handler: ShareHandler, failFirstBody = false): Promise<void> {
	const cache = new DelayedShareCache(failFirstBody);
	const cacheStorage = { open: async (): Promise<DelayedShareCache> => cache };
	let tokenNumber = 0;
	const cryptoImpl: Crypto = {
		subtle: globalThis.crypto.subtle,
		randomUUID: () => globalThis.crypto.randomUUID(),
		getRandomValues<T extends ArrayBufferView | null>(bytes: T): T {
			assert.ok(bytes instanceof Uint8Array);
			bytes.fill(++tokenNumber);
			return bytes;
		},
	};
	const configuration = { scope: '/', fallbacks: { standard: '/en/', embedded: '/embed/en/' } };
	const submit = (name: string, contents: string): Promise<Response> => handler({
		configuration, cacheStorage, cryptoImpl, request: request(name, contents), now: () => 1_000,
	});
	const first = submit('Interview.wav', 'first recording');
	await cache.firstBodyStored.ready;
	const second = submit('Room tone.wav', 'second recording');
	try {
		// Native form parsing and all immediately available cache operations may
		// settle, while the first Cache.put still awaits its disk acknowledgement.
		await nextTurn();
		await nextTurn();
		assert.ok(cache.entries.has(sharedFilesBodyUrl('01'.repeat(16), 0)),
			'a simultaneous share must not prune the first share before its manifest is written');
	} finally {
		cache.acknowledgeFirstBody.release();
	}
	const responses = await Promise.all([first, second]);
	if (failFirstBody) {
		assert.equal(new URL(responses[0]!.headers.get('location')!).searchParams.get('share-error'), 'storage');
	}
	for (const [index, response] of responses.entries()) {
		if (index === 0 && failFirstBody) continue;
		const collected = await collectSharedFiles({
			href: response.headers.get('location'), caches: cacheStorage,
			replaceAddress: () => {}, deliver: () => {},
		});
		assert.equal(collected.status, 'collected');
		assert.equal(collected.files.length, 1);
		assert.equal(await collected.files[0]!.text(), index === 0 ? 'first recording' : 'second recording');
	}
}

test('overlapping OS shares retain both complete recordings until their documents collect them', async () => {
	await overlappingShares(handleShareTargetSubmission);
});

test('the serialized production worker retains overlapping shares', async () => {
	const handler = new Function(`${shareTargetFunctionSources()}\nreturn handleShareTargetSubmission;`)() as ShareHandler;
	await overlappingShares(handler);
});

test('a refused cache write releases the next queued operating-system share', async () => {
	await overlappingShares(handleShareTargetSubmission, true);
});
