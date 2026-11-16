/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build only the bridge and its fixture from the parent's authenticated sources. */
export function windowsVst2X86BuildSteps({ target, configure, buildRoot, installRoot }) {
	if (target !== 'win-x64') return null;
	const root = `${buildRoot}-vst2-x86`;
	const argv = [...configure.argv];
	const platform = argv.indexOf('-A'), build = argv.indexOf('-B');
	if (platform < 0 || argv[platform + 1] !== 'x64' || build < 0) {
		throw new Error('The x86 VST2 bridge requires an authenticated Windows x64 parent recipe.');
	}
	argv[platform + 1] = 'Win32'; argv[build + 1] = root;
	argv.push('-DSOUNDSCAPER_WINDOWS_X86_VST2_BRIDGE=ON');
	return Object.freeze({
		configure: Object.freeze({ command: 'cmake', argv: Object.freeze(argv) }),
		build: Object.freeze({ command: 'cmake', argv: Object.freeze(['--build', root, '--config', 'Release',
			'--target', 'soundscaper_professional_peer', 'soundscaper_vst2_host_self_test', '--parallel', '2']) }),
		test: Object.freeze({ command: 'ctest', argv: Object.freeze(['--test-dir', root, '-C', 'Release',
			'-R', '^soundscaper_vst2_host_self_test$', '--output-on-failure', '--no-tests=error']) }),
		install: Object.freeze({ command: 'cmake', argv: Object.freeze(['--install', root, '--config', 'Release',
			'--prefix', installRoot, '--component', 'windows-x86-vst2-bridge']) }),
	});
}
