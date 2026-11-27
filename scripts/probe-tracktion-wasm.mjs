/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { provisionTracktionSources } from './lib/tracktion-sources.mjs';
import { prepareTracktionWasmPlatform, replaceWasmSource } from './lib/tracktion-wasm-platform.mjs';
import { tracktionCoreFiles } from './lib/tracktion-web-static.mjs';

const sdk = 'emscripten/emsdk:3.1.64@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc';
const cache = resolve(import.meta.dirname, '../.native-build');
const project = resolve(import.meta.dirname, '../native/soundscaper-tracktion');
const graphOnly = process.argv[2] === '--graph';
const browserCheck = process.argv[2] === '--browser';
const browserBuild = process.argv[2] === '--build-browser';
const coreDestination = process.argv[2] === '--build-browser-core' && process.argv[3];
const buildBrowserCore = browserCheck || browserBuild || coreDestination;
if (process.argv.length > (coreDestination ? 4 : 3) || (process.argv.length > 2 && !graphOnly && !buildBrowserCore)) {
	throw new Error('Usage: probe-tracktion-wasm.mjs [--graph | --browser | --build-browser | --build-browser-core DIRECTORY]');
}
const sources = await provisionTracktionSources();
mkdirSync(cache, { recursive: true });
const workspace = mkdtempSync(resolve(cache, 'tracktion-wasm-probe-'));
const output = resolve(workspace, 'output');

const replaceOnce = (path, original, replacement) => replaceWasmSource(workspace, path, original, replacement);

try {
	const tracktion = resolve(workspace, 'tracktion');
	if (graphOnly) cpSync(sources.tracktion, tracktion, { recursive: true });
	else execFileSync('cmake', [
		`-DSOUNDSCAPER_TRACKTION_SOURCE=${sources.tracktion}`, `-DSOUNDSCAPER_TRACKTION_WORKSPACE=${tracktion}`,
		'-P', resolve(project, 'wasm/prepare-tracktion.cmake'),
	], { stdio: 'inherit' });
	cpSync(sources.juce, resolve(workspace, 'juce'), { recursive: true });
	mkdirSync(output);

	// Browsers do not expose a physical CPU cycle counter or an x86 pause
	// instruction. Keep a compiler fence for non-realtime spin lock callers.
	const cpu = 'tracktion/modules/tracktion_core/utilities/tracktion_CPU.h';
	replaceOnce(cpu, '#pragma once', '#pragma once\n\n#include <atomic>');
	replaceOnce(cpu, '#elif TRACKTION_ARM\n // Use clang built-in',
		'#elif defined (__wasm__)\n // No platform intrinsics\n#elif TRACKTION_ARM\n // Use clang built-in');
	replaceOnce(cpu, '#if TRACKTION_ARM\n // Use asm yield',
		'#if defined (__wasm__)\n // No platform intrinsics\n#elif TRACKTION_ARM\n // Use asm yield');
	replaceOnce(cpu, 'inline std::uint64_t rdtsc()\n{\n   #if TRACKTION_ARM',
		'inline std::uint64_t rdtsc()\n{\n   #if defined (__wasm__)\n    return 0;\n   #elif TRACKTION_ARM');
	replaceOnce(cpu, 'inline void pause()\n{\n   #if TRACKTION_ARM',
		'inline void pause()\n{\n   #if defined (__wasm__)\n    std::atomic_signal_fence (std::memory_order_seq_cst);\n   #elif TRACKTION_ARM');
	replaceOnce('juce/modules/juce_core/native/juce_ThreadPriorities_native.h', '#if JUCE_LINUX || JUCE_BSD',
		'#if JUCE_LINUX || JUCE_BSD || JUCE_WASM');

	replaceOnce('juce/modules/juce_core/native/juce_SystemStats_wasm.cpp', '\nnamespace juce\n',
		'\n#include <emscripten.h>\n\nnamespace juce\n');
	replaceOnce('juce/modules/juce_core/system/juce_TargetPlatform.h', '#define       JUCE_WASM 1',
		'#define       JUCE_WASM 1\n  #define       JUCE_LITTLE_ENDIAN 1\n  #define       JUCE_32BIT 1');

	const backoff = 'tracktion/modules/3rd_party/crill/progressive_backoff_wait.h';
	replaceOnce(backoff, '#include "platform.h"', '#include <thread>\n#include "platform.h"');
	replaceOnce(backoff, '  #else\n    #error "Platform not supported!"',
		'  #elif defined (__wasm__)\n    while (!pred()) std::this_thread::yield();\n  #else\n    #error "Platform not supported!"');

	if (!graphOnly) prepareTracktionWasmPlatform(workspace, resolve(project, 'wasm'));

	const graphBuild = `
set -e
emcc -O0 -pthread -DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 -I/source/juce/modules -c /source/juce/modules/juce_core/juce_core_zlib.c -o juce-core-zlib.o
em++ -std=c++20 -O0 -pthread -DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 \\
	-DJUCE_USE_CURL=0 -DJUCE_USE_FLAC=0 -DJUCE_USE_OGGVORBIS=0 -DJUCE_USE_OPUS=0 \\
	-I/source/juce/modules -I/source/tracktion/modules \\
	/project/tests/wasm_graph_test.cpp /source/tracktion/modules/tracktion_graph/tracktion_graph.cpp \\
	/source/tracktion/modules/tracktion_core/tracktion_core.cpp \\
	/source/juce/modules/juce_audio_formats/juce_audio_formats.cpp \\
	/source/juce/modules/juce_audio_basics/juce_audio_basics.cpp \\
	/source/juce/modules/juce_core/juce_core.cpp \\
	/source/juce/modules/juce_core/juce_core_CompilationTime.cpp \\
	juce-core-zlib.o \\
	-sEXIT_RUNTIME=1 -sINITIAL_MEMORY=67108864 -sPTHREAD_POOL_SIZE=1 -o graph-test.js
node graph-test.js
`;
	const probe = spawnSync('docker', [
		'run', '--rm', '--network', 'none', '--memory', '4g', '--cpus', '2',
		'--volume', `${workspace}:/source:ro`, '--volume', `${project}:/project:ro`, '--volume', `${output}:/output`,
		'--workdir', '/tmp', sdk, 'bash',
		...(graphOnly ? ['-c', graphBuild] : ['/project/wasm/build-edit.sh', ...(buildBrowserCore ? ['--browser'] : [])]),
	], { stdio: 'inherit' });
	if (probe.error) throw probe.error;
	process.exitCode = probe.status ?? 1;
	if (buildBrowserCore && probe.status === 0) {
		const destination = browserCheck ? output : resolve(coreDestination || resolve(cache, 'tracktion-wasm-core'));
		if (!browserCheck) {
			mkdirSync(destination, { recursive: true });
			for (const name of tracktionCoreFiles) cpSync(resolve(output, name), resolve(destination, name));
		}
		if (browserCheck || browserBuild) {
			const { buildTracktionEditor, buildTracktionProjectWorker } = await import('./lib/tracktion-editor-build.mjs');
			await Promise.all([buildTracktionProjectWorker(destination), buildTracktionEditor(destination, true)]);
		}
		if (browserCheck) {
			const { verifyTracktionWasmInBrowsers } = await import('./lib/tracktion-wasm-browser-check.mjs');
			await verifyTracktionWasmInBrowsers(output);
		} else {
			console.log(`Built the Tracktion browser ${browserBuild ? 'editor' : 'core'} in ${destination}.`);
		}
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
