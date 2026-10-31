/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { repositoryModuleTestSuites } from './module-test-inventory.ts';
import { partitionModuleTestSuites, type ModuleTestSuite } from './module-test-suites.ts';

export interface ModuleNodeSelection {
	readonly modules: readonly string[];
	readonly suites: readonly string[];
	readonly shard: string | null;
	readonly list: boolean;
	readonly json: boolean;
	readonly remaining: readonly string[];
}

export function parseModuleNodeSelection(args: readonly string[], slots: readonly string[]): ModuleNodeSelection {
	const modules: string[] = [], suites: string[] = [], remaining: string[] = [];
	let shard: string | null = null, list = false, json = false;
	for (const argument of args) {
		if (argument === '--list') list = true;
		else if (argument === '--json') { json = true; list = true; }
		else if (argument.startsWith('--module=')) modules.push(...argument.slice(9).split(','));
		else if (argument.startsWith('--suite=')) suites.push(argument.slice(8));
		else if (argument.startsWith('--module-shard=')) {
			if (shard !== null) throw new TypeError('Select only one module execution shard.');
			shard = argument.slice(15);
			if (!slots.includes(shard)) throw new TypeError(`Unknown module execution shard: ${shard}.`);
		} else remaining.push(argument);
	}
	if ([...modules, ...suites].some(value => !value)) throw new TypeError('Module and suite selections must be nonempty.');
	return { modules: [...new Set(modules)], suites: [...new Set(suites)], shard, list, json, remaining };
}

export function selectModuleNodeFiles(root: string, selection: ModuleNodeSelection, slots: readonly string[]): {
	files: string[]; suites: ModuleTestSuite[];
} {
	const inventory = repositoryModuleTestSuites(root).filter(suite => suite.runtime === 'node');
	for (const id of selection.modules) if (!inventory.some(suite => suite.modules.includes(id))) throw new TypeError(`Module ${id} has no Node suite.`);
	for (const id of selection.suites) if (!inventory.some(suite => suite.id === id)) throw new TypeError(`Unknown Node suite: ${id}.`);
	const suites = inventory.filter(suite => (!selection.modules.length || selection.modules.some(id => suite.modules.includes(id)))
		&& (!selection.suites.length || selection.suites.includes(suite.id)));
	const files = selection.shard === null ? suites.flatMap(suite => suite.files)
		: partitionModuleTestSuites(suites, slots).get(selection.shard)!;
	return { files: files.map(file => resolve(root, file)).sort(), suites };
}
