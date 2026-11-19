/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 as resourcePaths,
	inspectLightscaperNativePhotoResourceDatabaseCurrentV1 as inspect } from '../../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { scopeAppDataCurrentV1 } from './lightscaper-native-library-scope-integration-fixture-current.ts';

export interface NativeLibraryOpeningTerminalCurrentV1 { readonly phase: 'terminal'; readonly closeFailed: boolean }

const directory = process.argv[2]; if (!directory || !process.send) throw new Error('Opening cleanup child requires actual fork IPC and appData.');
const send = process.send.bind(process), release = new Promise<void>(accept => { process.once('message', () => { accept(); }); });
const post = (value: Record<string, unknown>): Promise<void> => new Promise((accept, refuse) => { send(value, error => { if (error) refuse(error); else accept(); }); });
let owner: Scopes | undefined, schemaOwned = false, primaryInjected = false, cleanupInjected = false;
let openingFailed = false, faultCauses = false, closeFailed = false, traps = 0, initializationFailed = false;
const refused: boolean[] = [], primaryFault = new Error('Actual resource opening failed after native WAL and owned schema.'), cleanupFault = new Error('Actual resource native close completed then cleanup observation failed.');
async function rejects(run: () => unknown): Promise<boolean> { try { await run(); return false; } catch { return true; } }
try {
	owner = await Scopes.open({ appDataPath: directory }); const scope = await owner.allocate('catalog-1'), allocation = owner.describe(scope);
	if (!allocation) throw new Error('A real created allocation is required.');
	const path = resourcePaths(scopeAppDataCurrentV1(directory, allocation.namespaceToken)).databasePath;
	const nativeClose = DatabaseSync.prototype.close, nativePrepare = DatabaseSync.prototype.prepare, nativeExec = DatabaseSync.prototype.exec;
	const isResource = (database: DatabaseSync): boolean => { const row = Reflect.apply(nativePrepare, database, ['PRAGMA database_list']).get(); return typeof row?.file === 'string' && resolve(row.file) === resolve(path); };
	DatabaseSync.prototype.exec = function (sql: string): void {
		Reflect.apply(nativeExec, this, [sql]);
		if (!primaryInjected && /PRAGMA\s+journal_mode\s*=\s*WAL/iu.test(sql) && isResource(this)) {
			schemaOwned = inspect(this) === 'owned'; primaryInjected = true; throw primaryFault;
		}
	};
	DatabaseSync.prototype.close = function (): void {
		const target = isResource(this); Reflect.apply(nativeClose, this, []);
		if (target && primaryInjected && !cleanupInjected) { cleanupInjected = true; throw cleanupFault; }
	};
	try { await owner.openComponents(scope); }
	catch (error) {
		openingFailed = true;
		if (error instanceof AggregateError) {
			const causes: unknown = Object.getOwnPropertyDescriptor(error, 'errors')?.value;
			faultCauses = Array.isArray(causes) && causes.length === 2 && causes[0] === primaryFault && causes[1] === cleanupFault;
		}
	} finally { DatabaseSync.prototype.exec = nativeExec; DatabaseSync.prototype.close = nativeClose; }
	const current = owner;
	refused.push(await rejects(() => current.openDefault()), await rejects(() => current.allocate('catalog-1')), await rejects(() => current.resume(allocation.namespaceToken)), await rejects(() => current.readAllocationPage()));
	const value = new Proxy({}, { get() { traps++; throw Error('Unretired opening get'); }, ownKeys() { traps++; throw Error('Unretired opening ownKeys'); }, getPrototypeOf() { traps++; throw Error('Unretired opening prototype'); } });
	for (const [method, args] of [[current.openDefault, [value]], [current.allocate, [value, value]], [current.resume, [value, value]],
		[current.openComponents, [value, value]], [current.readAllocationPage, [value, value]], [current.describe, [value]]] as const) {
		refused.push(await rejects(() => Reflect.apply(method, current, args)));
	}
} catch { initializationFailed = true; }
if (owner) { try { await owner.close(); } catch { closeFailed = true; } }
await post({ phase: 'opening-failed', initialized: !initializationFailed, schemaOwned, primaryInjected, cleanupInjected, openingFailed, faultCauses, closeFailed, refused, traps });
await release; await post({ phase: 'terminal', closeFailed } satisfies NativeLibraryOpeningTerminalCurrentV1); process.disconnect?.();
