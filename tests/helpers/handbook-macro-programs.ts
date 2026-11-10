/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

export interface HandbookMacroProgram { readonly title: string; readonly source: string }

/** Keep the documentation itself as the fixture; unclassified programs retain browser execution. */
export const NODE_CONTROLLER_PROGRAMS: ReadonlySet<string> = new Set([
	'sound.command(name, params) (1)', 'Checking your assumptions (1)', 'Errors (1)', 'Examples (2)',
]);

export function readHandbookMacroPrograms(): readonly HandbookMacroProgram[] {
	const markdown = readFileSync(new URL('../../handbook/src/content/docs/reference/macro-programs.md', import.meta.url), 'utf8');
	const programs: HandbookMacroProgram[] = [], counts = new Map<string, number>();
	let heading = 'Macro programs', fence: string[] | null = null;
	for (const line of markdown.split('\n')) {
		if (fence) {
			if (line.startsWith('```')) {
				const ordinal = (counts.get(heading) ?? 0) + 1; counts.set(heading, ordinal);
				programs.push({ title: `${heading} (${ordinal})`, source: fence.join('\n') }); fence = null;
			} else fence.push(line);
			continue;
		}
		const headed = /^#{2,3}\s+(.+)$/u.exec(line);
		if (headed?.[1]) heading = headed[1].replace(/`/gu, '');
		else if (line.trim() === '```js') fence = [];
	}
	return programs;
}
