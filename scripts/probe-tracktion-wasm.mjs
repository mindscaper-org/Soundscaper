/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { provisionTracktionSources } from './lib/tracktion-sources.mjs';

const sdk = 'emscripten/emsdk:3.1.64@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc';
const cache = resolve(import.meta.dirname, '../.native-build');
const sources = await provisionTracktionSources();
mkdirSync(cache, { recursive: true });
const workspace = mkdtempSync(resolve(cache, 'tracktion-wasm-probe-'));

function replaceOnce(path, original, replacement) {
	const file = resolve(workspace, path);
	const text = readFileSync(file, 'utf8');
	if (text.indexOf(original) < 0 || text.indexOf(original) !== text.lastIndexOf(original)) {
		throw new Error(`The WASM probe patch does not match ${path}.`);
	}
	writeFileSync(file, text.replace(original, replacement));
}

try {
	cpSync(sources.tracktion, resolve(workspace, 'tracktion'), { recursive: true });
	cpSync(sources.juce, resolve(workspace, 'juce'), { recursive: true });

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

	replaceOnce('juce/modules/juce_core/native/juce_SystemStats_wasm.cpp', '\r\nnamespace juce\r\n',
		'\r\n#include <emscripten.h>\r\n\r\nnamespace juce\r\n');

	const backoff = 'tracktion/modules/3rd_party/crill/progressive_backoff_wait.h';
	replaceOnce(backoff, '#include "platform.h"', '#include <thread>\n#include "platform.h"');
	replaceOnce(backoff, '  #else\n    #error "Platform not supported!"',
		'  #elif defined (__wasm__)\n    while (!pred()) std::this_thread::yield();\n  #else\n    #error "Platform not supported!"');

	const probe = spawnSync('docker', [
		'run', '--rm', '--network', 'none', '--memory', '4g', '--cpus', '2',
		'--volume', `${workspace}:/source:ro`, '--workdir', '/tmp', sdk, 'bash', '-c', `
failed=0
for source in juce/modules/juce_core/juce_core.cpp tracktion/modules/tracktion_graph/tracktion_graph.cpp tracktion/modules/tracktion_engine/tracktion_engine_model_1.cpp juce/modules/juce_gui_basics/juce_gui_basics.cpp; do
	printf '\\n%s\\n' "$source"
	if em++ -std=c++20 -pthread -fsyntax-only -ferror-limit=2 -fno-caret-diagnostics \\
	        -DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 -DJUCE_USE_CURL=0 -DJUCE_WEB_BROWSER=0 \\
	        -I/source/juce/modules -I/source/tracktion/modules "/source/$source"; then
		printf 'passed\\n'
	else
		failed=1
	fi
done
exit "$failed"
`,
	], { stdio: 'inherit' });
	if (probe.error) throw probe.error;
	process.exitCode = probe.status ?? 1;
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
