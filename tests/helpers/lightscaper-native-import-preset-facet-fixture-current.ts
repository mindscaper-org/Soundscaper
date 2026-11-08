/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativePhotoImportPresetsCurrentV1 as Facet } from '../../desktop/lightscaper-native-photo-import-presets-current-v1.ts';
import { photoImportPresetsKeyV1 } from '../../src/lightscaper/storage/photo-import-presets-v1.ts';

export async function nativeImportPresetFacetFixtureCurrentV1(context: TestContext) {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native import preset facet ')));
	const owners: Settings[] = [], facets: Facet[] = [], controllers: AbortController[] = [];
	const active = new Set<Promise<unknown>>(), releases = new Set<() => void>();
	let stopped = false; const deadline = new Error('Import preset test deadline.');
	const stop = (): void => { stopped = true; for (const controller of controllers) controller.abort(deadline); for (const release of releases) release(); };
	const timer = setTimeout(stop, 15_000); context.signal.addEventListener('abort', stop, { once: true });
	context.after(async () => {
		clearTimeout(timer); context.signal.removeEventListener('abort', stop); stop();
		await Promise.allSettled([...active]);
		const retired = await Promise.allSettled(facets.map(facet => facet.close()));
		const closed = await Promise.allSettled(owners.map(owner => owner.close()));
		const failures = [...retired, ...closed].flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'Import preset fixture retained unretired actual owners.');
		await rm(appDataPath, { recursive: true, force: true });
	});
	const track = <Result>(work: Promise<Result>): Promise<Result> => {
		active.add(work); void work.catch(() => undefined); return work;
	};
	const open = (scope = 'anchor'): Promise<Settings> => {
		if (stopped) return Promise.reject(deadline);
		return track(Settings.open({ appDataPath, scope }).then(owner => { owners.push(owner); return owner; }));
	};
	const create = (owner: Settings, catalogId = 'catalog') => {
		if (stopped) throw deadline;
		const controller = new AbortController(); controllers.push(controller); let current = true;
		const retired = Symbol('retired selected import-preset epoch');
		const binding = { signal: controller.signal, assertCurrent(): void { if (this !== binding) throw new Error('Epoch receiver lost.'); if (!current) throw retired; } };
		const facet = Facet.create(owner, catalogId, binding); facets.push(facet);
		const retire = (reason: unknown = retired): void => { current = false; controller.abort(reason); };
		return { facet, values: facet.settingsRepository, binding, controller, retire, retired, key: photoImportPresetsKeyV1(catalogId) };
	};
	const owner = await open();
	return { appDataPath, databasePath: join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-settings.sqlite3'), owner, open, create, track, releases, ...create(owner) };
}

/** Actual native SQLite results only. The observer executes after the native
 * get has returned and preserves the original DB, SQL, receiver and result. */
export async function observeNativeImportPresetReadCurrentV1<Result>(databasePath: string, after: () => void, run: () => Promise<Result>): Promise<Result> {
	const prepare = DatabaseSync.prototype.prepare;
	DatabaseSync.prototype.prepare = function (sql: string) {
		const statement = prepare.call(this, sql);
		if (/^SELECT payload FROM native_photo_settings WHERE scope=\? AND key=\?$/u.test(sql)) {
			const row = prepare.call(this, 'PRAGMA database_list').get();
			if (typeof row?.file === 'string' && resolve(row.file) === resolve(databasePath)) {
				type Argument = SQLInputValue | Record<string, SQLInputValue>;
				const get = statement.get.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.get>;
				statement.get = function (...args: Argument[]) { const result = get(...args); after(); return result; };
			}
		}
		return statement;
	};
	try { return await run(); } finally { DatabaseSync.prototype.prepare = prepare; }
}

export async function exactNativeImportPresetFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	let rejected = false; await work.then(() => undefined, (failure: unknown) => { rejected = true; if (failure !== expected) throw new Error('Import preset refusal did not preserve the exact opaque reason.'); });
	if (!rejected) throw new Error('Import preset operation unexpectedly succeeded.');
}
