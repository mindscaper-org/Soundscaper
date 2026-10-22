/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 as resourcePaths } from '../../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { scopeAppDataCurrentV1 } from './lightscaper-native-library-scope-integration-fixture-current.ts';

export interface NativeLibraryQuarantineTerminalCurrentV1 { readonly phase: 'terminal'; readonly closeFailed: boolean }

const directory = process.argv[2]; if (!directory || !process.send) throw new Error('Quarantine child requires actual fork IPC and appData.');
const send = process.send.bind(process), release = new Promise<void>(accept => { process.once('message', () => { accept(); }); });
const post = (value: Record<string, unknown>): Promise<void> => new Promise((accept, refuse) => { send(value, error => { if (error) refuse(error); else accept(); }); });
let owner: Scopes | undefined, injected = false, componentFailed = false, closeFailed = false, traps = 0, initializationFailed = false;
const refused: boolean[] = [];
async function rejects(run: () => unknown): Promise<boolean> { try { await run(); return false; } catch { return true; } }
try {
	owner = await Scopes.open({ appDataPath: directory }); const scope = await owner.allocate('catalog-1'), allocation = owner.describe(scope);
	if (!allocation) throw new Error('A real created allocation is required.');
	const components = await owner.openComponents(scope), path = resourcePaths(scopeAppDataCurrentV1(directory, allocation.namespaceToken)).databasePath;
	const nativeClose = DatabaseSync.prototype.close, nativePrepare = DatabaseSync.prototype.prepare;
	DatabaseSync.prototype.close = function (): void {
		const row = Reflect.apply(nativePrepare, this, ['PRAGMA database_list']).get(), isResource = typeof row?.file === 'string' && resolve(row.file) === resolve(path);
		Reflect.apply(nativeClose, this, []);
		if (isResource && !injected) { injected = true; throw new Error('Injected only AFTER actual native resource database close.'); }
	};
	try { await components.close(); } catch { componentFailed = true; } finally { DatabaseSync.prototype.close = nativeClose; }
	const current = owner;
	refused.push(await rejects(() => current.openDefault()), await rejects(() => current.allocate('catalog-1')), await rejects(() => current.resume(allocation.namespaceToken)), await rejects(() => current.readAllocationPage()));
	const value = new Proxy({}, { get() { traps++; throw Error('Quarantined get'); }, ownKeys() { traps++; throw Error('Quarantined ownKeys'); }, getPrototypeOf() { traps++; throw Error('Quarantined prototype'); } });
	for (const [method, args] of [[current.openDefault, [value]], [current.allocate, [value, value]], [current.resume, [value, value]],
		[current.openComponents, [value, value]], [current.readAllocationPage, [value, value]], [current.describe, [value]]] as const) {
		refused.push(await rejects(() => Reflect.apply(method, current, args)));
	}
} catch { initializationFailed = true; }
await post({ phase: 'quarantined', initialized: !initializationFailed, injected, componentFailed, refused, traps });
await release;
if (owner) { try { await owner.close(); } catch { closeFailed = true; } }
await post({ phase: 'terminal', closeFailed } satisfies NativeLibraryQuarantineTerminalCurrentV1); process.disconnect?.();
