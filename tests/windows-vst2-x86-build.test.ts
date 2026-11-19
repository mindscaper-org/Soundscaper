/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { windowsVst2X86BuildSteps } from '../scripts/lib/windows-vst2-x86-build.mjs';

test('the x86 bridge is a Windows x64 sub-build and reuses the authenticated source arguments', () => {
	const configure = { command: 'cmake', argv: ['-S', '/src', '-B', '/build', '-A', 'x64', '-DSOUNDSCAPER_JUCE_ROOT=/authenticated/juce'] };
	const plan = windowsVst2X86BuildSteps({ target: 'win-x64', configure, buildRoot: '/build', installRoot: '/installed' });
	assert.ok(plan);
	assert.deepEqual(plan.configure.argv, ['-S', '/src', '-B', '/build-vst2-x86', '-A', 'Win32',
		'-DSOUNDSCAPER_JUCE_ROOT=/authenticated/juce', '-DSOUNDSCAPER_WINDOWS_X86_VST2_BRIDGE=ON']);
	assert.ok(plan.build.argv.includes('soundscaper_professional_peer'));
	assert.ok(!plan.build.argv.includes('soundscaper_professional_node'));
	assert.ok(plan.install.argv.includes('windows-x86-vst2-bridge'));
	assert.equal(configure.argv[5], 'x64');
	for (const target of ['win-arm64', 'linux-x64', 'linux-arm64', 'mac-arm64']) {
		assert.equal(windowsVst2X86BuildSteps({ target, configure, buildRoot: '/build', installRoot: '/installed' }), null);
	}
});
