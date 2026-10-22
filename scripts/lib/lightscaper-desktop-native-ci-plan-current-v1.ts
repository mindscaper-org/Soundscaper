/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const LIGHTSCAPER_DESKTOP_NATIVE_CI_TARGETS_CURRENT_V1 = Object.freeze([
	Object.freeze({ target: 'linux-x64', platform: 'linux', arch: 'x64', node_arch: 'x64', runner: 'ubuntu-24.04' }),
	Object.freeze({ target: 'linux-arm64', platform: 'linux', arch: 'arm64', node_arch: 'arm64', runner: 'ubuntu-24.04-arm' }),
	Object.freeze({ target: 'mac-arm64', platform: 'mac', arch: 'arm64', node_arch: 'arm64', runner: 'macos-15' }),
	Object.freeze({ target: 'win-x64', platform: 'win', arch: 'x64', node_arch: 'x64', runner: 'windows-2025' }),
	Object.freeze({ target: 'win-arm64', platform: 'win', arch: 'arm64', node_arch: 'arm64', runner: 'windows-11-arm' }),
] as const);
export type LightscaperDesktopNativeCiTargetCurrentV1 = typeof LIGHTSCAPER_DESKTOP_NATIVE_CI_TARGETS_CURRENT_V1[number];
export interface LightscaperDesktopNativeCiPhaseCurrentV1 {
	readonly name: 'native' | 'web'; readonly backend: 'native' | 'web'; readonly scenario: 'linked' | 'managed';
	readonly nativeBuildResultRoot: string | null; readonly buildRoot: string; readonly packageRoot: string; readonly smokeRoot: string;
}
export interface LightscaperDesktopNativeCiPlanCurrentV1 {
	readonly target: LightscaperDesktopNativeCiTargetCurrentV1; readonly sourceRevision: string; readonly workRoot: string;
	readonly phases: readonly Readonly<LightscaperDesktopNativeCiPhaseCurrentV1>[];
}
export function readLightscaperDesktopNativeCiTargetCurrentV1(value: unknown): LightscaperDesktopNativeCiTargetCurrentV1 {
	for (const row of LIGHTSCAPER_DESKTOP_NATIVE_CI_TARGETS_CURRENT_V1) if (row.target === value) return row;
	throw new TypeError('Internal Photo qualification target is unsupported.');
}
/** This plan grants no executable, artifact or retirement authority. Actual
 * source inventory/package checks and real process owners are the runner's job. */
export function createLightscaperDesktopNativeCiPlanCurrentV1(options: Readonly<{
	target: string; sourceRevision: string; workRoot: string; nativeBuildResultRoot: string;
}>): Readonly<LightscaperDesktopNativeCiPlanCurrentV1> {
	const target = readLightscaperDesktopNativeCiTargetCurrentV1(options.target), sourceRevision = options.sourceRevision;
	if (typeof sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(sourceRevision)) throw new TypeError('Internal Photo qualification needs an exact source commit.');
	const workRoot = absolute(options.workRoot), nativeBuildResultRoot = absolute(options.nativeBuildResultRoot);
	if (inside(workRoot, nativeBuildResultRoot) || inside(nativeBuildResultRoot, workRoot)) throw new Error('Authenticated input and disposable work must be disjoint.');
	const phases = (['native', 'web'] as const).map(name => Object.freeze({ name, backend: name,
		scenario: name === 'native' ? 'linked' as const : 'managed' as const,
		nativeBuildResultRoot: name === 'native' ? nativeBuildResultRoot : null,
		buildRoot: join(workRoot, name, 'stage'), packageRoot: join(workRoot, name, 'package'), smokeRoot: join(workRoot, name, 'smoke') }));
	return Object.freeze({ target, sourceRevision, workRoot, phases: Object.freeze(phases) });
}
function absolute(value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) throw new TypeError('Internal Photo paths must be canonical absolute spellings.');
	return value;
}
function inside(parent: string, child: string): boolean {
	const path = relative(parent, child); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
}
