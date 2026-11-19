/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { syncDirectory } from './desktop-directory-durability.ts';
import { clearDesktopStorageCopyStage, isDesktopStorageLinkUnavailable } from './desktop-storage-copy-stage.ts';
import { migrateDesktopStorageEntries } from './desktop-storage-migration.ts';
import { openProjectLibraryDirectoryLock, projectLibraryLocationDirectory } from './project-library-directory-lock.ts';

const LEGACY_COPY_RECORD = 'legacy-upgrade-v1';
const LEGACY_COPY_RECORD_BODY = /^([a-f0-9]{32}) ([a-f0-9]{64})\n$/u;
const LEGACY_COPY_RECORD_SIZE = 98;

export interface DesktopProjectLibraryMigrationOptions {
	readonly legacyAppDataPath: string;
	readonly projectLibraryAppDataPath: string;
	readonly appName: string;
}

/** Relocate only the current product library; archived schema stores remain untouched. */
export async function migrateDesktopProjectLibraries(
	options: DesktopProjectLibraryMigrationOptions,
): Promise<void> {
	const { legacyAppDataPath, projectLibraryAppDataPath, appName } = options;
	for (const [label, path] of Object.entries({ legacyAppDataPath, projectLibraryAppDataPath })) {
		if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
			throw new TypeError(`Desktop project-library ${label} must be an absolute path without NUL bytes.`);
		}
	}
	if (typeof appName !== 'string' || !appName || appName === '.' || appName === '..'
		|| /[/\\\0]/u.test(appName)) {
		throw new TypeError('Desktop project-library appName must be a single path component without NUL bytes.');
	}
	const destination = join(projectLibraryAppDataPath, appName, 'project-library', 'v1');
	const bases = new Set([resolve(legacyAppDataPath), resolve(projectLibraryAppDataPath)]);
	const entries = [...bases].map((base) => ({
		source: join(base, 'kw.media', `${appName.toLowerCase()}-project-library`, 'v1'),
		destination,
	}));
	if (process.platform !== 'linux' && process.platform !== 'win32') return migrateDesktopStorageEntries(entries);

	const location = projectLibraryLocationDirectory(projectLibraryAppDataPath, appName);
	const record = join(location, LEGACY_COPY_RECORD);
	if (!await optionalEntry(record) && !(await Promise.all(entries.map(({ source }) => optionalEntry(source)))).some(Boolean)) {
		return migrateDesktopStorageEntries(entries);
	}
	const directory = await optionalEntry(location);
	if (directory && !directory.isDirectory()) throw new Error('The project library location must be a regular directory.');
	const release = openProjectLibraryDirectoryLock(projectLibraryAppDataPath, appName, 'move');
	try {
		const identity = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
		let stage = await readLegacyCopyStage(location, record, identity);
		await migrateDesktopStorageEntries(entries, {
			copyStageDirectory: stage,
			createCopyStage: async () => {
				stage = await registerLegacyCopyStage(location, record, identity);
				return stage;
			},
		});
		if (stage !== undefined) {
			await clearDesktopStorageCopyStage(stage);
			await unlink(record);
			await syncDirectory(location);
		}
	} finally { release(); }
}

async function readLegacyCopyStage(location: string, record: string, identity: string): Promise<string | undefined> {
	const previous = await lstat(record, { bigint: true }).catch((error: unknown) => {
		if (missing(error)) return null;
		throw error;
	});
	if (previous === null) return undefined;
	if (!previous.isFile()) throw new Error('The legacy project library copy record must be a regular file.');
	const handle = await open(record, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
	try {
		const entry = await handle.stat({ bigint: true });
		if (!entry.isFile() || entry.dev !== previous.dev || entry.ino !== previous.ino
			|| entry.size !== BigInt(LEGACY_COPY_RECORD_SIZE)) throw new Error('Invalid legacy project library copy record.');
		const body = Buffer.alloc(LEGACY_COPY_RECORD_SIZE);
		const { bytesRead } = await handle.read(body);
		if (bytesRead !== body.length) throw new Error('Invalid legacy project library copy record.');
		const match = LEGACY_COPY_RECORD_BODY.exec(body.toString('utf8'));
		if (!match || match[2] !== identity || match[1] === undefined) {
			throw new Error('The legacy project library copy belongs to a different storage location.');
		}
		return await legacyCopyDirectory(location, match[1]);
	} finally { await handle.close(); }
}

async function registerLegacyCopyStage(location: string, record: string, identity: string): Promise<string | undefined> {
	const id = randomBytes(16).toString('hex');
	const temporary = join(location, `${LEGACY_COPY_RECORD}-${id}.tmp`);
	await writeFile(temporary, `${id} ${identity}\n`, { mode: 0o600, flag: 'wx', flush: true });
	try {
		try { await link(temporary, record); }
		catch (error) {
			if (isDesktopStorageLinkUnavailable(error)) return undefined;
			throw error;
		}
		await syncDirectory(location);
		return await legacyCopyDirectory(location, id);
	} finally { await unlink(temporary); }
}

async function legacyCopyDirectory(location: string, id: string): Promise<string> {
	const path = join(location, `${LEGACY_COPY_RECORD}-${id}`);
	await mkdir(path, { recursive: true, mode: 0o700 });
	if (!(await lstat(path)).isDirectory()) throw new Error('The legacy project library copy stage must be a regular directory.');
	return path;
}

async function optionalEntry(path: string) {
	try { return await lstat(path); }
	catch (error) { if (missing(error)) return null; throw error; }
}

function missing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
