/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface WindowsInstalledCodecTextOptions {
	readonly publish?: (temporary: string, destination: string) => Promise<void>;
}

async function withHandle<T>(handle: FileHandle, use: (handle: FileHandle) => Promise<T>): Promise<T> {
	let failed = false, primary: unknown, value: T | undefined;
	try { value = await use(handle); } catch (error) { failed = true; primary = error; }
	let cleanupFailed = false, cleanup: unknown;
	try { await handle.close(); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (cleanupFailed) {
		if (failed) throw new AggregateError([primary, cleanup], 'Installed codec metadata handle retirement failed.', { cause: primary });
		throw cleanup;
	}
	if (failed) throw primary;
	return value as T;
}


/** Bound, validate and atomically replace only the owned derived installation
 * file. Validation/publication failures retain the original and retire our temp. */
export async function rewriteWindowsInstalledCodecText(file: string, maximumBytes: number,
	transform: (bytes: Buffer) => Buffer, options: Readonly<WindowsInstalledCodecTextOptions> = {}): Promise<void> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 131_072) throw new RangeError('Installed codec metadata byte bound is invalid.');
	const path = resolve(file), before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumBytes) {
		throw new Error('Installed codec metadata must be one bounded regular file.');
	}
	const bytes = await withHandle(await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), async handle => {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.dev !== before.dev || metadata.ino !== before.ino || metadata.size !== before.size) {
			throw new Error('Installed codec metadata changed during admission.');
		}
		const buffer = Buffer.alloc(maximumBytes + 1); let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length !== metadata.size || length > maximumBytes) throw new Error('Installed codec metadata changed its bounded length.');
		return buffer.subarray(0, length);
	});
	const text = bytes.toString('utf8');
	if (text.includes('\0') || !Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Installed codec metadata must be bounded UTF-8 text.');
	const output = transform(bytes);
	if (!Buffer.isBuffer(output) || output.length < 1 || output.length > maximumBytes) throw new Error('Installed codec metadata output exceeds its bound.');
	const temporary = `${path}.pending-${randomUUID()}`;
	let owned = false, failed = false, primary: unknown;
	try {
		const handle = await open(temporary, 'wx', before.mode & 0o777); owned = true;
		await withHandle(handle, async file => { await file.writeFile(output); await file.sync(); });
		const current = await lstat(path);
		if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
			|| current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw new Error('Installed codec metadata changed before publication.');
		await (options.publish ?? rename)(temporary, path); owned = false;
	} catch (error) { failed = true; primary = error; }
	let cleanupFailed = false, cleanup: unknown;
	if (owned) try { await unlink(temporary); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (cleanupFailed) {
		if (failed) throw new AggregateError([primary, cleanup], 'Installed codec metadata publication and temporary retirement failed.', { cause: primary });
		throw cleanup;
	}
	if (failed) throw primary;
}
