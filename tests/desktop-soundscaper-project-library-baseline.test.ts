/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	DESKTOP_PROJECT_LIBRARY_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
	SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	createSoundscaperDesktopProjectLibraryHandshake,
	createSoundscaperDesktopProjectLibraryPaths,
	validateSoundscaperDesktopProjectLibraryHandshake,
} from '../desktop/soundscaper-project-library-contract.ts'
import {
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity,
	initializeSoundscaperDesktopProjectLibraryDatabase,
} from '../desktop/soundscaper-project-library-database.ts'
import {
	validateSoundscaperDesktopProjectLibraryCatalogSnapshot,
} from '../desktop/soundscaper-project-library-lifecycle-contract.ts'
import {
	MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES,
	validateSoundscaperDesktopProjectLibraryBodyReadRequest,
} from '../desktop/soundscaper-project-library-transfer-contract.ts'
import { validateSoundscaperDesktopProjectLibraryPublicationAdmission } from '../desktop/soundscaper-project-library-publication-transport.ts'
import {
	acquireSoundscaperDesktopProjectLibraryLeaseWithWait,
} from '../desktop/soundscaper-project-library-lease-wait.ts'
import { SoundscaperDesktopProjectLibraryCatalog } from '../desktop/soundscaper-project-library-catalog.ts'
import { validateSoundscaperDesktopCurrentProject } from '../desktop/soundscaper-project-library-current-project.ts'
import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts'
import {
	validateSoundscaperDesktopCatalogSnapshot,
} from '../src/soundscaper/desktop-project-library-renderer-contract.ts'
import { validateSoundscaperDesktopAdmission } from '../src/soundscaper/desktop-project-library-renderer-validation.ts'
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts'
import { waitFor } from './helpers/async-test-control.ts'

test('Soundscaper desktop baseline freezes the exact family-qualified v1 identity', () => {
	assert.equal(SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION, 1)
	assert.equal(DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION, 1)
	assert.equal(DESKTOP_PROJECT_LIBRARY_APPLICATION_ID, 0x53534350)
	assert.deepEqual(createSoundscaperDesktopProjectLibraryHandshake(), {
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: 'soundscaper',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: 'kw-media-soundscaper-editor-v1',
		desktopLibrarySchemaVersion: 1,
		desktopDatabaseUserVersion: 1,
		desktopLibraryScope: ['Soundscaper', 'project-library', 'v1'],
	})
	assert.match(createSoundscaperDesktopProjectLibraryPaths(
		join(tmpdir(), 'soundscaper-baseline-contract'),
	).libraryRoot, /Soundscaper[/\\]project-library[/\\]v1$/u)
})

test('Soundscaper desktop baseline handshake rejects accessors and pre-release identities', () => {
	const accessor = { ...createSoundscaperDesktopProjectLibraryHandshake() } as Record<string, unknown>
	Object.defineProperty(accessor, 'schemaFamily', { enumerable: true, get: () => 'soundscaper' })
	assert.throws(() => validateSoundscaperDesktopProjectLibraryHandshake(accessor), /data property/iu)
	assert.throws(() => validateSoundscaperDesktopProjectLibraryHandshake({
		...createSoundscaperDesktopProjectLibraryHandshake(),
		schemaVersion: 30,
	}), /unsupported/iu)
	assert.throws(() => validateSoundscaperDesktopProjectLibraryHandshake({
		...createSoundscaperDesktopProjectLibraryHandshake(),
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v1'],
	}), /scope is unsupported/iu)
})

test('Soundscaper desktop baseline admits only current family v1 documents', () => {
	const current = createSoundscaperProject({ id: 'desktop-baseline', title: 'Desktop baseline' })
	assert.equal(validateSoundscaperDesktopCurrentProject(current), current)
	assert.throws(() => validateSoundscaperDesktopCurrentProject({
		...current,
		schemaFamily: 'framescaper',
	}), /Soundscaper project schema identity/iu)
})

test('Soundscaper desktop baseline catalog rows carry the exact schema tuple', () => {
	const mainSnapshot = validateSoundscaperDesktopProjectLibraryCatalogSnapshot({
		metadataRevision: 0,
		projects: [{
			schemaFamily: 'soundscaper',
			schemaVersion: 1,
			id: 'project-one',
			title: 'Project one',
			revision: 0,
			updatedAt: '2026-08-28T00:00:00.000Z',
		}],
	})
	assert.deepEqual(mainSnapshot.projects[0], {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		id: 'project-one',
		title: 'Project one',
		revision: 0,
		updatedAt: '2026-08-28T00:00:00.000Z',
	})
	assert.deepEqual(validateSoundscaperDesktopCatalogSnapshot(mainSnapshot), mainSnapshot)
	assert.throws(() => validateSoundscaperDesktopProjectLibraryCatalogSnapshot({
		metadataRevision: 0,
		projects: [{
			schemaFamily: 'framescaper',
			schemaVersion: 1,
			id: 'project-one',
			title: 'Project one',
			revision: 0,
			updatedAt: '2026-08-28T00:00:00.000Z',
		}],
	}), /unsupported identity/iu)
})

test('Soundscaper desktop baseline initializes only exact SSCP user_version 1 databases', () => {
	const database = new DatabaseSync(':memory:')
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity(database)
	assert.equal(database.prepare('PRAGMA application_id').get()?.application_id, 0x53534350)
	assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 1)
	database.close()

	const retired = new DatabaseSync(':memory:')
	retired.exec('PRAGMA application_id = 1397965648; PRAGMA user_version = 13')
	assert.throws(
		() => initializeSoundscaperDesktopProjectLibraryDatabase(retired),
		/unsupported Soundscaper desktop baseline database version/iu,
	)
	assert.equal(retired.prepare('PRAGMA user_version').get()?.user_version, 13)
	retired.close()
})

test('Soundscaper startup does not write an already-current library schema', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-current-schema-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const path = join(root, 'library.sqlite3')
	const writer = new DatabaseSync(path)
	initializeSoundscaperDesktopProjectLibraryDatabase(writer)
	writer.exec('BEGIN IMMEDIATE')
	const current = new DatabaseSync(path, { readOnly: true })
	try {
		current.exec('PRAGMA synchronous = NORMAL; PRAGMA trusted_schema = ON; PRAGMA foreign_keys = OFF')
		assert.doesNotThrow(() => initializeSoundscaperDesktopProjectLibraryDatabase(current))
		assertSoundscaperDesktopProjectLibraryDatabaseIdentity(current)
		assert.equal(current.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete')
		assert.equal(current.prepare('PRAGMA synchronous').get()?.synchronous, 2)
		assert.equal(current.prepare('PRAGMA trusted_schema').get()?.trusted_schema, 0)
		assert.equal(current.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1)
	} finally {
		current.close()
		writer.exec('ROLLBACK')
		writer.close()
	}
})

test('an expired but still-owned writer lease renews after event-loop suspension', () => {
	const database = new DatabaseSync(':memory:')
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	let now = 10
	const catalog = SoundscaperDesktopProjectLibraryCatalog.create({
		database,
		owner: { product: 'soundscaper', processId: 930, instanceId: 'suspended-writer' },
		now: () => now,
		randomId: () => 'a'.repeat(48),
	})
	catalog.acceptHandshake(createSoundscaperDesktopProjectLibraryHandshake())
	const lease = catalog.acquireLease({ ttlMs: 1_000 })
	now = 1_011
	const renewed = catalog.renewLease(lease, { ttlMs: 1_000 })
	assert.equal(renewed.leaseId, lease.leaseId)
	assert.equal(renewed.fencingToken, lease.fencingToken)
	assert.equal(renewed.expiresAtMs, 2_011)
	database.close()
})

test('a backwards wall-clock step cannot shorten an owned writer lease', () => {
	const database = new DatabaseSync(':memory:')
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	let now = 1_000_000
	const catalog = SoundscaperDesktopProjectLibraryCatalog.create({
		database,
		owner: { product: 'soundscaper', processId: 930, instanceId: 'backwards-clock' },
		now: () => now,
		randomId: () => 'b'.repeat(48),
	})
	catalog.acceptHandshake(createSoundscaperDesktopProjectLibraryHandshake())
	const lease = catalog.acquireLease({ ttlMs: 30_000 })
	now = 975_000
	const renewed = catalog.renewLease(lease, { ttlMs: 30_000 })

	assert.ok(renewed.expiresAtMs >= lease.expiresAtMs)
	database.close()
})

test('Soundscaper main reports a writer-lease loss exactly once', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-lease-loss-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const losses: unknown[] = []
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 931, instanceId: 'lease-loss' },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		onLeaseLost: (error: unknown) => { losses.push(error) },
		testControl: { leaseTtlMs: 1_000, renewIntervalMs: 1, checkpoint: null },
	})
	const database = new DatabaseSync(createSoundscaperDesktopProjectLibraryPaths(root).databasePath)
	database.prepare('UPDATE library_lease SET lease_id = ? WHERE singleton = 1').run('f'.repeat(48))
	database.close()
	await waitFor(() => losses.length > 0, 'the stolen lease to be reported lost', {
		turns: 50, delayMs: 2,
	})
	assert.equal(main.snapshot().fenced, true)
	assert.equal(losses.length, 1)
	await main.close()
})

test('Soundscaper startup waits out transient database initialization contention', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-startup-contention-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const paths = createSoundscaperDesktopProjectLibraryPaths(root)
	await mkdir(paths.libraryRoot, { recursive: true })
	const database = new DatabaseSync(paths.databasePath)
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	database.close()

	const locker = spawn(process.execPath, [
		'--input-type=module',
		'--eval',
		`import { DatabaseSync } from 'node:sqlite'
const database = new DatabaseSync(process.argv[1])
database.exec('BEGIN IMMEDIATE')
process.stdout.write('locked\\n')
setTimeout(() => {
	database.exec('COMMIT')
	database.close()
}, 250)`,
		paths.databasePath,
	], { stdio: ['ignore', 'pipe', 'inherit'] })
	context.after(() => {
		if (locker.exitCode === null && locker.signalCode === null) locker.kill('SIGKILL')
	})
	const lockerExit = new Promise<number | null>((resolve, reject) => {
		locker.once('error', reject)
		locker.once('exit', resolve)
	})
	await new Promise<void>((resolve, reject) => {
		locker.once('error', reject)
		locker.stdout.once('data', (chunk) => {
			assert.equal(String(chunk), 'locked\n')
			resolve()
		})
	})

	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 933, instanceId: 'startup-contention' },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: { leaseTtlMs: 1_000, renewIntervalMs: 500, checkpoint: null },
	})
	await main.close()
	assert.equal(await lockerExit, 0)
})

test('Soundscaper baseline never opens or changes either pre-release desktop library', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-baseline-isolation-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const retired = [['v10', 12], ['v11', 13]] as const
	for (const [scope, userVersion] of retired) {
		const libraryRoot = join(root, 'kw.media', 'soundscaper-project-library', scope)
		await mkdir(libraryRoot, { recursive: true })
		const database = new DatabaseSync(join(libraryRoot, 'library.sqlite3'))
		database.exec(`
			PRAGMA application_id = 1397965648;
			PRAGMA user_version = ${String(userVersion)};
			CREATE TABLE retired_witness (value BLOB NOT NULL);
			INSERT INTO retired_witness (value) VALUES (x'00ff${userVersion.toString(16).padStart(2, '0')}');
		`)
		database.close()
		await writeFile(join(libraryRoot, 'untouched.bin'), new Uint8Array([0, 255, userVersion]))
	}

	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 932, instanceId: 'baseline-isolation' },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: null,
	})
	await main.close()

	for (const [scope, userVersion] of retired) {
		const libraryRoot = join(root, 'kw.media', 'soundscaper-project-library', scope)
		assert.deepEqual(await readFile(join(libraryRoot, 'untouched.bin')),
			Buffer.from([0, 255, userVersion]), scope)
		const database = new DatabaseSync(join(libraryRoot, 'library.sqlite3'))
		assert.equal(database.prepare('PRAGMA application_id').get()?.application_id, 0x53534350, scope)
		assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, userVersion, scope)
		assert.equal(database.prepare('SELECT hex(value) AS value FROM retired_witness').get()?.value,
			`00FF${userVersion.toString(16).padStart(2, '0').toUpperCase()}`, scope)
		database.close()
	}
})

test('a refused direct publication can retry the same publication ID', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-library-publication-retry-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const handshake = createSoundscaperDesktopProjectLibraryHandshake()
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root, handshake,
		owner: { product: 'soundscaper', processId: 934, instanceId: 'publication-retry' },
		onLeaseLost: () => undefined,
		testControl: null,
	})
	try {
		const session = main.openSession(handshake)
		const project = createSoundscaperProject({ id: 'retry-publication', title: 'Retry publication' })
		const publicationId = 'ab'.repeat(24)
		const request = {
			publicationId, expectedMetadataRevision: 0, expectedProject: null, project, bodies: [],
		}
		await assert.rejects(() => session.beginPublication({ ...request, expectedMetadataRevision: 1 }), /revision/iu)
		assert.equal((await session.beginPublication(request)).publicationId, publicationId)
		assert.equal((await session.finishPublication({ publicationId })).document, JSON.stringify(project))
	} finally { await main.close() }
})

test('publication admission requires sorted, dense missing-body indexes in the retained request contracts', () => {
	const admission = {
		publicationId: 'a'.repeat(48), maximumChunkBytes: MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES,
		bodyCount: 2, requiredBodyIndexes: [0, 1],
	}
	assert.deepEqual(validateSoundscaperDesktopProjectLibraryPublicationAdmission(admission, 2)
		.requiredBodyIndexes, [0, 1])
	assert.deepEqual(validateSoundscaperDesktopAdmission(admission, 2).requiredBodyIndexes, [0, 1])
	for (const requiredBodyIndexes of [[1, 0], [0, 0], [2], new Array(1)]) {
		assert.throws(() => validateSoundscaperDesktopProjectLibraryPublicationAdmission(
			{ ...admission, requiredBodyIndexes }, 2))
		assert.throws(() => validateSoundscaperDesktopAdmission({ ...admission, requiredBodyIndexes }, 2))
	}
})

test('the retained body read validator refuses prototype-named data fields', () => {
	const request = Object.defineProperty({}, '__proto__', { value: null, enumerable: true })
	assert.throws(() => validateSoundscaperDesktopProjectLibraryBodyReadRequest(request), /unsupported fields/u)
	assert.equal(Object.hasOwn(request, '__proto__'), true)
	assert.equal(Object.getPrototypeOf(request), Object.prototype)
})

test('Soundscaper baseline lease retry recognizes only current contention', async () => {
	let attempts = 0
	assert.equal(await acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
		attempts += 1
		if (attempts === 1) throw new Error('Soundscaper desktop baseline writer lease is busy')
		return 'lease'
	}, { waitMs: 50, pollIntervalMs: 10 }), 'lease')
	assert.equal(attempts, 2)
	let refusalAttempts = 0
	await assert.rejects(
		() => acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
			refusalAttempts += 1
			if (refusalAttempts === 1) {
				throw new Error('Soundscaper desktop baseline writer lease is busy')
			}
			throw Object.assign(new Error('database is locked'), { errcode: 517 })
		}, { waitMs: 10, pollIntervalMs: 10 }),
		/Soundscaper desktop baseline writer lease is busy/u,
	)
	// The deadline is read from a millisecond clock while the poll timer runs
	// on the event loop's own clock, so the second attempt may land a whole
	// millisecond "early" and earn one more poll on a slow runner. What matters
	// is that contention keeps the loop going and the first busy error is
	// what surfaces, not the exact number of polls a 10 ms window allows.
	assert.ok(refusalAttempts >= 2, `expected at least two attempts, saw ${refusalAttempts}`)
	for (const errcode of [5, 6, 261, 262, 517, 773]) {
		let contentionAttempts = 0
		assert.equal(await acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
			contentionAttempts += 1
			if (contentionAttempts === 1) {
				throw Object.assign(new Error('database is locked'), { errcode })
			}
			return 'lease'
		}, { waitMs: 50, pollIntervalMs: 10 }), 'lease')
		assert.equal(contentionAttempts, 2)
	}
	const unrelated = Object.assign(new Error('SQLite read-only refusal'), { errcode: 264 })
	let unrelatedAttempts = 0
	await assert.rejects(
		() => acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
			unrelatedAttempts += 1
			throw unrelated
		}, { waitMs: 50, pollIntervalMs: 10 }),
		(error: unknown) => error === unrelated,
	)
	assert.equal(unrelatedAttempts, 1)
	await assert.rejects(
		() => acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
			throw new Error('Soundscaper desktop V11 writer lease is busy')
		}, { waitMs: 50, pollIntervalMs: 10 }),
		/V11/iu,
	)
})
