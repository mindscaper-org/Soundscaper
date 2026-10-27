/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAXIMUM_BYTES = 16_384;
type Publish = (temporary: string, destination: string) => Promise<void>;

async function withHandle<T>(handle: FileHandle, use: (handle: FileHandle) => Promise<T>): Promise<T> {
	let failed = false, primary: unknown, value: T | undefined;
	try { value = await use(handle); } catch (error) { failed = true; primary = error; }
	let cleanupFailed = false, cleanup: unknown;
	try { await handle.close(); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (cleanupFailed) {
		if (failed) throw new AggregateError([primary, cleanup], 'SVT metadata handle retirement failed.', { cause: primary });
		throw cleanup;
	}
	if (failed) throw primary;
	return value as T;
}

function normalized(bytes: Buffer): Buffer {
	const text = bytes.toString('utf8');
	if (bytes.length > MAXIMUM_BYTES || text.includes('\0') || !Buffer.from(text, 'utf8').equals(bytes)) {
		throw new Error('SVT pkg-config metadata exceeds its bounded UTF-8 text contract.');
	}
	const fields = (name: string): string[] => [...text.matchAll(new RegExp(`^[\\t ]*${name.replaceAll('.', '\\.')}:([^\\r\\n]*)`, 'gmu'))]
		.map(match => match[1]!.trim());
	if (JSON.stringify(fields('Name')) !== '["SvtAv1Enc"]' || JSON.stringify(fields('Version')) !== '["4.2.0"]'
		|| JSON.stringify(fields('Cflags.private')) !== '["-UEB_DLL"]') {
		throw new Error('SVT pkg-config metadata must have one pinned 4.2.0 identity and exactly its expected private undefine.');
	}
	const match = /^[\t ]*Cflags\.private:([\t ]*)-UEB_DLL[\t ]*(?:\r?\n|$)/mu.exec(text);
	if (!match) throw new Error('SVT pkg-config private metadata is malformed.');
	const characterOffset = match.index + match[0].indexOf('-UEB_DLL');
	const offset = Buffer.byteLength(text.slice(0, characterOffset));
	return Buffer.concat([bytes.subarray(0, offset), bytes.subarray(offset + '-UEB_DLL'.length)]);
}

/** Only derived Windows installation metadata changes. The compiler retains
 * this static ABI undefine through FFmpeg's separate compiler-only CFLAGS. */
export async function normalizeWindowsSvtPkgConfig(file: string, options: Readonly<{ publish?: Publish }> = {}): Promise<void> {
	const path = resolve(file), before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAXIMUM_BYTES) {
		throw new Error('SVT pkg-config metadata must be one bounded regular file.');
	}
	const bytes = await withHandle(await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), async handle => {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.dev !== before.dev || metadata.ino !== before.ino || metadata.size !== before.size) {
			throw new Error('SVT pkg-config metadata changed during admission.');
		}
		const buffer = Buffer.alloc(MAXIMUM_BYTES + 1); let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length !== metadata.size || length > MAXIMUM_BYTES) throw new Error('SVT pkg-config metadata changed its bounded length.');
		return buffer.subarray(0, length);
	});
	const output = normalized(bytes), temporary = `${path}.pending-${randomUUID()}`;
	let owned = false, failed = false, primary: unknown;
	try {
		const handle = await open(temporary, 'wx', before.mode & 0o777); owned = true;
		await withHandle(handle, async file => { await file.writeFile(output); await file.sync(); });
		const current = await lstat(path);
		if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
			|| current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw new Error('SVT pkg-config metadata changed before publication.');
		await (options.publish ?? rename)(temporary, path); owned = false;
	} catch (error) { failed = true; primary = error; }
	let cleanupFailed = false, cleanup: unknown;
	if (owned) try { await unlink(temporary); } catch (error) { cleanupFailed = true; cleanup = error; }
	if (cleanupFailed) {
		if (failed) throw new AggregateError([primary, cleanup], 'SVT metadata publication and temporary retirement failed.', { cause: primary });
		throw cleanup;
	}
	if (failed) throw primary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	if (process.argv.length !== 3) throw new TypeError('Supply one installed SVT pkg-config metadata file.');
	await normalizeWindowsSvtPkgConfig(process.argv[2]!);
}
