/* SPDX-License-Identifier: AGPL-3.0-only */
import { posix, win32 } from 'node:path';
import type { MotionProcessIdentity } from '../scripts/performance/motionscaper-sustained-process.ts';

export interface MotionQualificationOwner {
	readonly platform: 'linux' | 'win32' | 'darwin'; readonly pid: number; readonly parent: number;
	/** Kernel start ticks, Windows creation FILETIME, or Darwin start seconds.microseconds. */
	readonly birth: string; readonly executable: string;
}
/** Preserve the reviewed process selector's parent field at the native-controller boundary. */
export function motionQualificationProcessIdentity(owner: MotionQualificationOwner): MotionProcessIdentity {
	return { pid: owner.pid, parentPid: owner.parent, startTicks: owner.birth };
}
export type MotionQualificationChooserKind = 'authored-save' | 'authored-export' | 'authored-cancel-export'
	| 'scene-open' | 'scene-export' | 'successor-open' | 'successor-export';
const choices = {
	'authored-save': ['Save Motionscaper project', 'save', 'saved.mscape', 'save-project'],
	'authored-export': ['Export ProRes 4444', 'save', 'output.mov', 'export'],
	'authored-cancel-export': ['Export ProRes 4444', 'cancel', 'output.mov', 'cancel-export'],
	'scene-open': ['Open Motionscaper project', 'open', 'saved.mscape', 'scene-open'],
	'scene-export': ['Export ProRes 4444', 'save', 'output.mov', 'scene-export'],
	'successor-open': ['Connect saved Motionscaper composition', 'open', 'saved.mscape', 'successor-open'],
	'successor-export': ['Export Frame sequence as ProRes 4444', 'save', 'output.mov', 'successor-export'],
} as const;

export function verifyMotionQualificationOwner(expected: MotionQualificationOwner, actual: MotionQualificationOwner): void {
	for (const value of [expected, actual]) {
		if (!['linux', 'win32', 'darwin'].includes(value.platform) || !Number.isSafeInteger(value.pid) || value.pid < 1
			|| !Number.isSafeInteger(value.parent) || value.parent < 0 || !/^[1-9]\d{0,24}(?:\.\d{1,6})?$/u.test(value.birth)) throw new Error('Invalid process identity.');
		const paths = value.platform === 'win32' ? win32 : posix;
		if (!paths.isAbsolute(value.executable) || value.executable.includes('\0') || paths.normalize(value.executable) !== value.executable) throw new Error('Invalid process executable identity.');
	}
	if (actual.pid !== expected.pid || actual.birth !== expected.birth || actual.platform !== expected.platform || actual.executable !== expected.executable) {
		throw new Error('Owned native process identity changed.');
	}
}

export function motionQualificationChooserRequest(owner: MotionQualificationOwner, kind: MotionQualificationChooserKind, path: string, directory: string) {
	verifyMotionQualificationOwner(owner, owner);
	const selected = choices[kind]; if (!selected) throw new Error('Unsupported native chooser action.');
	const paths = owner.platform === 'win32' ? win32 : posix;
	for (const value of [path, directory]) if (!value || value.length > 8192 || value.includes('\0') || !paths.isAbsolute(value) || paths.normalize(value) !== value) throw new Error('Invalid owned chooser path.');
	if (paths.dirname(path) !== directory) throw new Error('Chooser path escapes its owned directory.');
	if (paths.basename(path) !== selected[2]) throw new Error('Unexpected qualification chooser filename.');
	return Object.freeze({ schemaVersion: 1, owner, kind, path, directory, caption: selected[0], action: selected[1], linuxMode: selected[3] });
}

/** Native controllers return the actual app status; mere retirement is never a successful workflow. */
export function motionQualificationApplicationExitAccepted(terminal: Readonly<{ code: number | null; signal: NodeJS.Signals | null }> | null,
	permitted: ReadonlySet<number>, nativeClosure?: unknown): boolean {
	if (!terminal) return false;
	const code = terminal.signal === null ? terminal.code : terminal.code !== null ? null
		: terminal.signal === 'SIGTERM' ? 143 : terminal.signal === 'SIGKILL' ? 137 : null;
	if (code === null || !permitted.has(code)) return false;
	if (nativeClosure === undefined) return true; // Linux directly reaps the authenticated application ChildProcess.
	if (!nativeClosure || typeof nativeClosure !== 'object') return false;
	const value = nativeClosure as { physicalClosed?: unknown; timedOut?: unknown; failure?: unknown; exitCode?: unknown; remainingOwned?: unknown };
	return terminal.signal === null && value.physicalClosed === true && value.timedOut === false && value.failure === null && value.exitCode === terminal.code
		&& (value.remainingOwned === 0 || Array.isArray(value.remainingOwned) && value.remainingOwned.length === 0);
}

/** A capability probe is admission metadata, never an actual UI/workflow qualification. */
export function verifyMotionQualificationWindowsProbe(probe: unknown, interactive: boolean, arch: string = process.arch): void {
	if (!probe || typeof probe !== 'object') throw new Error('Missing Windows controller probe.');
	const value = probe as { schemaVersion?: unknown; platform?: unknown; architecture?: unknown; hostQualified?: unknown; capabilities?: unknown };
	if (value.schemaVersion !== 1 || value.platform !== 'win32' || value.hostQualified !== false) throw new Error('Invalid Windows controller probe.');
	if (!['x64', 'arm64'].includes(arch) || value.architecture !== arch) throw new Error('Windows native host architecture differs from the current Node target.');
	if (!value.capabilities || typeof value.capabilities !== 'object') throw new Error('Missing Windows controller capability.');
	for (const key of ['retainedHandleFiletime', 'suspendedOwnedJob', 'exactOwnedUiAutomation', 'stdinControlPipeRequired']) {
		if (Reflect.get(value.capabilities, key) !== true) throw new Error(`Missing Windows controller capability ${key}.`);
	}
	const desktop = Reflect.get(value.capabilities, 'interactiveDesktop');
	if (typeof desktop !== 'boolean' || interactive && !desktop) throw new Error('Windows UI qualification requires an interactive owned desktop.');
}
