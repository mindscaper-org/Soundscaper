/* SPDX-License-Identifier: AGPL-3.0-only */
import { realpathSync } from 'node:fs';
type State = { owners: number; pins: number; reads: number; repair: boolean; failed: boolean };
const NAMESPACES = new Map<string, State>(), QUARANTINE = new Set<object>();
/** Same-process physical ownership only. Production Scopes supplies the actual
	* appData-wide cross-process writer guard; this map never substitutes for it. */
export function registerLightscaperNativeOriginalPhysicalNamespaceCurrentV1(path: string) {
	const actual = realpathSync(path), key = process.platform === 'win32' ? actual.toLowerCase() : actual;
	let state = NAMESPACES.get(key); if (!state) { state = { owners: 0, pins: 0, reads: 0, repair: false, failed: false }; NAMESPACES.set(key, state); }
	const selected = state; selected.owners++; let retired = false;
	const collect = (): void => { if (!selected.failed && selected.owners === 0 && selected.pins === 0 && selected.reads === 0 && !selected.repair) NAMESPACES.delete(key); };
	const current = (): void => { if (retired || selected.failed) throw new Error('Native Original physical namespace is retired or quarantined.'); };
	return Object.freeze({
	 assertCurrent: current,
	 read: (): Readonly<{ release(): void }> => { current(); if (selected.reads >= 4) throw new Error('Native Original physical read capacity is busy.'); selected.reads++; let used = false;
	  return Object.freeze({ release: (): void => { if (!used) { used = true; selected.reads--; collect(); } } }); },
	 pin: (): Readonly<{ release(): void }> => { current(); if (selected.pins >= 4094) throw new Error('Native Original physical consumer capacity is busy.'); selected.pins++; let used = false;
	  return Object.freeze({ release: (): void => { if (!used) { used = true; selected.pins--; collect(); } } }); },
	 repair: (): Readonly<{ release(): void }> => { current(); if (selected.repair) throw new Error('A native Original physical repair is already active.'); selected.repair = true; let used = false;
	  return Object.freeze({ release: (): void => { if (!used) { used = true; selected.repair = false; collect(); } } }); },
	 quarantine: (owner: object): void => { selected.failed = true; QUARANTINE.add(owner); },
	 retire: (): void => { if (!retired) { retired = true; selected.owners--; collect(); } },
	});
}
