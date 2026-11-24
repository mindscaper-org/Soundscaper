/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants, createWriteStream, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import { MAX_DESKTOP_SAVE_BYTES } from './constants.js';
import { AtomicSaveManager, SaveTargetStore } from './save-targets.js';

// The imported WAV occupies one RIFF chunk with a 32-bit size.
const MAXIMUM_WAVE_BYTES = 0xffff_ffff + 8;

export async function stageTracktionWave(source: string, destination: string, signal: AbortSignal): Promise<void> {
	await withSnapshot(source, MAXIMUM_WAVE_BYTES, async (input, initial) => {
		await pipeline(
			input.createReadStream({ autoClose: false, end: Number(initial.size) - 1 }),
			createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
			{ signal },
		);
		if (!sameSnapshot(initial, await input.stat({ bigint: true }))
			|| (await lstat(destination, { bigint: true })).size !== initial.size) {
			throw new Error('The selected WAV changed while it was being staged.');
		}
	});
}

export function createTracktionExportWriter() {
	const targets = new SaveTargetStore();
	const saves = new AtomicSaveManager({ targets });

	async function publish(source: string, destination: string, owner: object, signal: AbortSignal): Promise<void> {
		await withSnapshot(source, MAX_DESKTOP_SAVE_BYTES, async (input, initial) => {
			signal.throwIfAborted();
			const target = targets.registerPath(destination, {
				owner, purpose: 'tracktion-export', beforeCommit: () => { signal.throwIfAborted(); },
			});
			try {
				const { writeId, chunkSize } = await saves.begin({ owner, targetId: target.id, size: Number(initial.size) });
				try {
					const buffer = new Uint8Array(chunkSize);
					const size = Number(initial.size);
					let offset = 0;
					while (offset < size) {
						signal.throwIfAborted();
						const { bytesRead } = await input.read(buffer, 0, Math.min(chunkSize, size - offset), offset);
						if (bytesRead < 1) throw new Error('The Tracktion export ended early.');
						await saves.writeChunk({ writeId, owner, offset, bytes: buffer.subarray(0, bytesRead) });
						offset += bytesRead;
					}
					if (!sameSnapshot(initial, await input.stat({ bigint: true }))) {
						throw new Error('The Tracktion export changed before publication.');
					}
					signal.throwIfAborted();
					await saves.finish(writeId, { owner });
				} catch (error) {
					await saves.abort(writeId, { owner }).catch(() => undefined);
					throw error;
				}
			} finally {
				targets.release(target.id, { owner });
			}
		});
	}
	return {
		publish,
		revokeOwner: (owner: object) => saves.revokeOwner(owner),
		dispose: () => saves.dispose(),
	};
}

async function withSnapshot<Result>(
	path: string,
	maximumBytes: number,
	operation: (handle: FileHandle, initial: BigIntStats) => Promise<Result>,
): Promise<Result> {
	const selected = await lstat(path, { bigint: true });
	if (!selected.isFile() || selected.size <= 0 || selected.size > BigInt(maximumBytes)) {
		throw new Error('The selected file is outside the Tracktion file bounds.');
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const initial = await handle.stat({ bigint: true });
		if (!sameSnapshot(selected, initial)) throw new Error('The selected file changed while it was being opened.');
		return await operation(handle, initial);
	} finally {
		await handle.close();
	}
}

function sameSnapshot(before: BigIntStats, after: BigIntStats): boolean {
	return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size
		&& before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
