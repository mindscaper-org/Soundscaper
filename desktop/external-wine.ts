/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main/helper-owned Wine discovery. Probing never installs Wine or initializes a prefix. */
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';
import { createExternalFfmpegNodeRunner } from './external-ffmpeg-node-runtime.ts';
import type { ExternalFfmpegProcessRunner } from './external-ffmpeg-probe.ts';

export interface ExternalWineInstallation {
	readonly state: 'ready' | 'unavailable' | 'unsupported' | 'unsupported-target' | 'error';
	readonly location: string | null;
	readonly version: string | null;
	readonly sha256: string | null;
}

export function wineDiscoveryCandidates(environment: Readonly<NodeJS.ProcessEnv> = process.env): readonly string[] {
	const directories = [...(environment.PATH ?? '').split(':'), '/usr/bin', '/usr/local/bin',
		'/opt/wine-staging/bin', '/opt/wine-devel/bin', '/opt/wine-stable/bin'];
	return Object.freeze([...new Set([
		...(absolute(environment.WINELOADER) ? [environment.WINELOADER] : []),
		...directories.filter(absolute).flatMap((directory) => [join(directory, 'wine'), join(directory, 'wine64')]),
	])]);
}

export function parseWineVersion(output: string): readonly [number, number, number] | null {
	const match = /^wine-(\d+)\.(\d+)(?:\.(\d+))?(?: \([^\r\n]*\))?\r?\n?$/u.exec(output);
	if (!match) return null;
	const version = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] as const;
	return version.every(Number.isSafeInteger) && version[0] >= 9 ? version : null;
}

export async function discoverExternalWine(options: Readonly<{
	platform?: NodeJS.Platform;
	architecture?: string;
	environment?: Readonly<NodeJS.ProcessEnv>;
	selectedPath?: string | null;
	candidates?: readonly string[];
	workingDirectory?: string;
	runner?: ExternalFfmpegProcessRunner;
}> = {}): Promise<Readonly<ExternalWineInstallation>> {
	if ((options.platform ?? process.platform) !== 'linux' || (options.architecture ?? process.arch) !== 'x64') {
		return unavailable('unsupported-target', null);
	}
	if (options.selectedPath !== undefined && options.selectedPath !== null && !absolute(options.selectedPath)) {
		throw new TypeError('A selected Wine executable must have an absolute, NUL-free path.');
	}
	const candidates = options.selectedPath ? [options.selectedPath]
		: options.candidates ?? wineDiscoveryCandidates(options.environment);
	const runner = options.runner ?? createExternalFfmpegNodeRunner({
		workingDirectory: options.workingDirectory ?? tmpdir(), environment: options.environment,
	});
	const seen = new Set<string>();
	let selected: Readonly<ExternalWineInstallation> | null = null;
	let highest = [-1, -1, -1] as readonly number[];
	let failure: ExternalWineInstallation['state'] = 'unavailable';
	for (const candidate of candidates) {
		if (!absolute(candidate)) continue;
		try {
			const path = await realpath(candidate);
			if (seen.has(path)) continue;
			seen.add(path);
			await access(path, constants.X_OK);
			const before = await authenticatePluginCandidate(path);
			if (before.kind !== 'file' || before.byteLength > 256 * 1024 ** 2) continue;
			const result = await runner.run({ executablePath: path, arguments: ['--version'], shell: false,
				standardInput: 'ignore', maximumDurationMs: 5_000, maximumOutputBytes: 64 * 1024 });
			if (result.status !== 'exited' || result.exitCode !== 0) { failure = 'error'; continue; }
			const version = parseWineVersion(result.stdout);
			if (!version) { failure = 'unsupported'; continue; }
			const after = await authenticatePluginCandidate(path);
			if (after.sha256 !== before.sha256 || after.byteLength !== before.byteLength
				|| String(after.identity.dev) !== String(before.identity.dev)
				|| String(after.identity.ino) !== String(before.identity.ino)) { failure = 'error'; continue; }
			const greater = version.some((value, index) => value > highest[index]!
				&& version.slice(0, index).every((part, previous) => part === highest[previous]));
			if (!selected || greater) {
				highest = version;
				selected = Object.freeze({ state: 'ready', location: path, version: version.join('.'), sha256: after.sha256 });
			}
		} catch (error) {
			if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) failure = 'error';
		}
	}
	return selected ?? unavailable(failure, options.selectedPath ?? null);
}

function unavailable(state: ExternalWineInstallation['state'], location: string | null): Readonly<ExternalWineInstallation> {
	return Object.freeze({ state, location, version: null, sha256: null });
}

function absolute(value: string | undefined): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 4_096 && !value.includes('\0') && isAbsolute(value);
}
