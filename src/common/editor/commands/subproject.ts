/* SPDX-License-Identifier: AGPL-3.0-only */
import type { SubprojectLink } from '../subprojects.ts';

export const SUBPROJECT_COMMAND_TYPES = ['subproject/install', 'subproject/relink', 'subproject/follow', 'subproject/detach'] as const;
export interface SubprojectCommandPayloads {
	readonly 'subproject/install': { readonly expected: SubprojectLink | null; readonly link: SubprojectLink; readonly source: Readonly<Record<string, unknown>> };
	readonly 'subproject/relink': { readonly expected: SubprojectLink; readonly link: SubprojectLink; readonly source: Readonly<Record<string, unknown>> };
	readonly 'subproject/follow': { readonly expected: SubprojectLink; readonly followLatest: boolean };
	readonly 'subproject/detach': { readonly expected: SubprojectLink };
}
export type SubprojectCommand = { [Key in keyof SubprojectCommandPayloads]:
	Readonly<{ type: Key }> & SubprojectCommandPayloads[Key]
}[keyof SubprojectCommandPayloads];
