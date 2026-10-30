#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkModuleBoundaries } from './lib/check-module-boundary-policy.ts';
import { parseModulePolicy } from './lib/module-policy.ts';

if (process.argv.length > 2) throw new TypeError('check-module-boundaries accepts no arguments.');
const root = resolve(import.meta.dirname, '..');
const policy = parseModulePolicy(JSON.parse(readFileSync(resolve(root, 'config/module-policy.json'), 'utf8')) as unknown);
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
const snapshot = new Map<string, string>();
for (const file of new Set(paths)) {
	if (!/^(?:src|desktop|native|tests|scripts|functions)\//u.test(file) || !existsSync(resolve(root, file))) continue;
	snapshot.set(file, /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file) ? readFileSync(resolve(root, file), 'utf8') : '');
}
const failures = checkModuleBoundaries(snapshot, policy);
if (failures.length) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write('Extracted module ownership and dependency boundaries passed.\n');
}
