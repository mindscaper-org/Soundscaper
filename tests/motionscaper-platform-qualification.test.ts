/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionQualificationTarget, requireMotionQualificationHost } from '../desktop/motionscaper-qualification-platform.ts';
import { resolveMotionQualificationPaths } from '../desktop/motionscaper-native-qualification-paths.ts';
import { motionQualificationOutputLimit } from '../desktop/motionscaper-qualification-command.ts';
import { motionQualificationApplicationExitAccepted, motionQualificationChooserRequest, verifyMotionQualificationOwner, verifyMotionQualificationWindowsProbe } from '../desktop/motionscaper-qualification-policy.ts';

test('Motion native qualification uses the five own targets and rejects an emulated target claim', () => {
	for (const [platform, arch, target] of [
		['linux', 'x64', 'linux-x64'], ['linux', 'arm64', 'linux-arm64'],
		['win32', 'x64', 'win-x64'], ['win32', 'arm64', 'win-arm64'], ['darwin', 'arm64', 'mac-arm64'],
	] as const) assert.equal(motionQualificationTarget(platform, arch), target);
	for (const [platform, arch] of [['darwin', 'x64'], ['freebsd', 'x64'], ['linux', 'arm']] as const) {
		assert.throws(() => motionQualificationTarget(platform, arch), /target/u);
	}
	assert.throws(() => requireMotionQualificationHost('win-arm64', {}, 'win32', 'x64'), /host/u);
	assert.throws(() => requireMotionQualificationHost('linux-arm64', {}, 'linux', 'arm64'), /X11 display/u);
	assert.doesNotThrow(() => requireMotionQualificationHost('linux-arm64', { DISPLAY: ':10', MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY: ':10' }, 'linux', 'arm64'));
});

test('Motion qualification resolves actual Windows executables and macOS bundle resources', () => {
	const windows = resolveMotionQualificationPaths('C:\\checkout', 'motionscaper', 'arm64', {}, 'win32');
	assert.equal(windows.executable, 'C:\\checkout\\release\\desktop-nightly-products\\motionscaper\\win-arm64-unpacked\\Motionscaper.exe');
	assert.equal(windows.resources, 'C:\\checkout\\release\\desktop-nightly-products\\motionscaper\\win-arm64-unpacked\\resources');
	const frame = resolveMotionQualificationPaths('C:\\checkout', 'framescaper-successor', 'x64', {}, 'win32');
	assert.equal(frame.executable, 'C:\\checkout\\release\\framescaper-successor\\win-unpacked\\Framescaper Development.exe');
	const mac = resolveMotionQualificationPaths('/checkout', 'motionscaper', 'arm64', {}, 'darwin');
	assert.equal(mac.package, '/checkout/release/desktop-nightly-products/motionscaper/mac-arm64');
	assert.equal(mac.executable, `${mac.package}/Motionscaper.app/Contents/MacOS/Motionscaper`);
	assert.equal(mac.resources, `${mac.package}/Motionscaper.app/Contents/Resources`);
	assert.throws(() => resolveMotionQualificationPaths('/checkout', 'motionscaper', 'x64', {}, 'darwin'), /target/u);
});

test('Native dialog custody rejects a reused PID or different executable before input', () => {
	const owner = { platform: 'win32', pid: 27, parent: 1, birth: '638990000000000000', executable: 'C:\\app\\Motionscaper.exe' } as const;
	assert.doesNotThrow(() => verifyMotionQualificationOwner(owner, { ...owner }));
	assert.throws(() => verifyMotionQualificationOwner(owner, { ...owner, birth: '638990000000000001' }), /identity/u);
	assert.throws(() => verifyMotionQualificationOwner(owner, { ...owner, executable: 'C:\\foreign\\Motionscaper.exe' }), /identity/u);
	assert.throws(() => verifyMotionQualificationOwner(owner, { ...owner, pid: 28 }), /identity/u);
});

test('Native chooser grants stay inside one owned directory and select only the intended action', () => {
	const owner = { platform: 'win32', pid: 27, parent: 1, birth: '638990000000000000', executable: 'C:\\app\\Motionscaper.exe' } as const;
	const save = motionQualificationChooserRequest(owner, 'authored-save', 'C:\\owned\\saved.mscape', 'C:\\owned');
	assert.equal(save.caption, 'Save Motionscaper project'); assert.equal(save.action, 'save');
	const cancel = motionQualificationChooserRequest(owner, 'authored-cancel-export', 'C:\\owned\\output.mov', 'C:\\owned');
	assert.equal(cancel.action, 'cancel'); assert.equal(cancel.caption, 'Export ProRes 4444');
	for (const path of ['C:\\foreign\\saved.mscape', 'C:\\owned\\..\\saved.mscape', 'C:\\owned\\wrong.mscape', 'relative']) {
		assert.throws(() => motionQualificationChooserRequest(owner, 'authored-save', path, 'C:\\owned'), /(?:path|filename|directory)/u);
	}
	assert.throws(() => motionQualificationChooserRequest(owner, 'successor-open', 'C:\\owned\\output.mov', 'C:\\owned'), /filename/u);
});

test('Native command output bounds preserve authored 64 KiB and bounded aggregate 2 MiB profiles', () => {
	assert.equal(motionQualificationOutputLimit(), 65536);
	assert.equal(motionQualificationOutputLimit(2 * 1024 * 1024), 2097152);
	for (const value of [0, -1, 1.5, NaN, Infinity, 2097153]) assert.throws(() => motionQualificationOutputLimit(value), /bound/u);
});

test('Application cleanup refuses crashes, timeout and incomplete Job/session closure despite physical retirement', () => {
	const terminal = { code: 0, signal: null }, closure = { physicalClosed: true, exitCode: 0, timedOut: false, failure: null, remainingOwned: [] };
	assert.equal(motionQualificationApplicationExitAccepted(terminal, new Set([0]), closure), true);
	for (const changed of [{ ...closure, exitCode: 1 }, { ...closure, timedOut: true }, { ...closure, failure: 'caller EOF' },
		{ ...closure, remainingOwned: [12] }, { ...closure, physicalClosed: false }]) assert.equal(motionQualificationApplicationExitAccepted(terminal, new Set([0]), changed), false);
	assert.equal(motionQualificationApplicationExitAccepted({ code: 1, signal: null }, new Set([0]), { ...closure, exitCode: 1 }), false);
	assert.equal(motionQualificationApplicationExitAccepted(terminal, new Set([0]), null), false);
	assert.equal(motionQualificationApplicationExitAccepted({ code: null, signal: 'SIGTERM' }, new Set([0])), false);
	assert.equal(motionQualificationApplicationExitAccepted({ code: null, signal: 'SIGTERM' }, new Set([0, 143])), true);
	assert.equal(motionQualificationApplicationExitAccepted({ code: null, signal: 'SIGSEGV' }, new Set([0, 143])), false);
});

test('Windows probe must match native host architecture and owned-process capabilities before UI admission', () => {
	const capabilities = { retainedHandleFiletime: true, suspendedOwnedJob: true, exactOwnedUiAutomation: true,
		stdinControlPipeRequired: true, interactiveDesktop: true };
	const probe = { schemaVersion: 1, platform: 'win32', architecture: 'arm64', capabilities, hostQualified: false };
	assert.doesNotThrow(() => verifyMotionQualificationWindowsProbe(probe, true, 'arm64'));
	assert.throws(() => verifyMotionQualificationWindowsProbe(probe, true, 'x64'), /architecture/u);
	assert.throws(() => verifyMotionQualificationWindowsProbe({ ...probe, capabilities: { ...capabilities, retainedHandleFiletime: false } }, true, 'arm64'), /capability/u);
	const unavailable = { ...probe, capabilities: { ...capabilities, interactiveDesktop: false } };
	assert.doesNotThrow(() => verifyMotionQualificationWindowsProbe(unavailable, false, 'arm64'));
	assert.throws(() => verifyMotionQualificationWindowsProbe(unavailable, true, 'arm64'), /interactive/u);
	assert.throws(() => verifyMotionQualificationWindowsProbe({ ...probe, hostQualified: true }, true, 'arm64'), /probe/u);
});
