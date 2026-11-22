/* SPDX-License-Identifier: AGPL-3.0-only */
import { cpSync } from 'node:fs';
import { join } from 'node:path';

export function stageBundledVst3(source: string, destination: string, target: string): void {
	// JUCE adds these bundle-root files for Explorer folder icons.
	const shellDecoration = new Set(target.startsWith('win-')
		? [join(source, 'desktop.ini'), join(source, 'Plugin.ico')] : []);
	cpSync(source, destination, { recursive: true, filter: path => !shellDecoration.has(path) });
}
