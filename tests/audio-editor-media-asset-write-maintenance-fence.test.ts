/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';

test('whole-blob media writes are refused during maintenance', async () => {
	const { media, opfs } = repository();
	const maintenance = media.beginAssetMaintenance();
	try {
		await assert.rejects(
			media.writeAsset('blocked', new Blob(['blocked'])),
			/Media asset storage is under maintenance/u,
		);
	} finally {
		maintenance.release();
		opfs.close();
	}
});

test('maintenance aborts an admitted whole-blob digest read before publication', { timeout: 15_000 }, async context => {
	let releaseRead!: () => void;
	let markReadStarted!: () => void;
	let refuseReadStarted!: (reason: unknown) => void;
	const readStarted = new Promise<void>((resolve, reject) => { markReadStarted = resolve; refuseReadStarted = reject; });
	const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
	const { media, opfs } = repository();
	const caller = new AbortController();
	const nativeArrayBuffer = Blob.prototype.arrayBuffer;
	let nativeReads = 0;
	let deadlineExpired = false;
	const stop = () => {
		const reason = context.signal.reason ?? new Error('Media maintenance fixture cancelled.');
		caller.abort(reason); releaseRead(); refuseReadStarted(reason);
	};
	context.signal.addEventListener('abort', stop, { once: true });
	const deadline = setTimeout(() => {
		deadlineExpired = true;
		const reason = new Error('Actual media digest barrier did not retire before its deadline.');
		caller.abort(reason); releaseRead(); refuseReadStarted(reason);
	}, 13_000);
	Blob.prototype.arrayBuffer = async function heldNativeArrayBuffer(this: Blob): Promise<ArrayBuffer> {
		const bytes = await nativeArrayBuffer.call(this);
		nativeReads += 1;
		assert.equal(new TextDecoder().decode(bytes), 'racing');
		markReadStarted();
		await readGate;
		return bytes;
	};
	let write: Promise<unknown> | undefined;
	let observing: Promise<void> | undefined;
	let aborting: Promise<void> | undefined;
	let maintenance: ReturnType<MediaRepository['beginAssetMaintenance']> | undefined;
	try {
		write = media.writeAsset('racing', new Blob(['racing']), {}, { signal: caller.signal });
		observing = write.then(
			() => { refuseReadStarted(new Error('Whole-Blob write completed without entering the actual digest barrier.')); },
			refuseReadStarted,
		);
		await readStarted;
		maintenance = media.beginAssetMaintenance();
		let abortJoined = false;
		aborting = maintenance.abortActive().then(() => { abortJoined = true; });
		await Promise.resolve();
		assert.equal(abortJoined, false, 'maintenance must join the accepted held native read');
		releaseRead();
		await assert.rejects(write, { name: 'AbortError' });
		await aborting;
		assert.equal(nativeReads, 1);
		assert.equal(await media.getAssetMetadata('racing'), null);
		assert.equal(deadlineExpired, false);
	} finally {
		releaseRead();
		caller.abort(new Error('Media maintenance fixture retired.'));
		await Promise.allSettled([write, observing, aborting]);
		maintenance?.release();
		Blob.prototype.arrayBuffer = nativeArrayBuffer;
		context.signal.removeEventListener('abort', stop);
		clearTimeout(deadline);
		opfs.close();
	}
});

function repository(): Readonly<{ media: MediaRepository; opfs: OpfsRepository }> {
	const memory = getMemoryDatabase(`media-write-maintenance-${String(Date.now())}-${String(Math.random())}`);
	const opfs = new OpfsRepository({ preferOpfs: false });
	const media = new MediaRepository({ memory, database: async () => null }, opfs);
	return { media, opfs };
}
