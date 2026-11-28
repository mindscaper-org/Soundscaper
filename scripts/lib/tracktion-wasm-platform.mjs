/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const modules = 'juce/modules';

export function replaceWasmSource(workspace, path, original, replacement) {
	const file = resolve(workspace, path);
	const source = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
	if (source.indexOf(original) === -1 || source.indexOf(original) !== source.lastIndexOf(original)) {
		throw new Error(`The Tracktion WASM patch does not match ${path}.`);
	}
	writeFileSync(file, source.replace(original, replacement));
}

/** Add headless platform implementations to the authenticated JUCE build copy. */
export function prepareTracktionWasmPlatform(workspace, platformSources) {
	const patch = (file, original, replacement) => replaceWasmSource(workspace, `${modules}/${file}`, original, replacement);
	const install = (module, source) => {
		copyFileSync(resolve(platformSources, `${source}.inc`), resolve(workspace, `${modules}/${module}/native/${source}.inc`));
		return `#include "native/${source}.inc"`;
	};
	const appendPlatform = (module, source) => {
		const include = install(module, source);
		appendFileSync(resolve(workspace, `${modules}/${module}/${module}.cpp`), `\n#if JUCE_WASM\n ${include}\n#endif\n`);
	};

	const core = 'juce_core/juce_core.cpp';
	patch(core, '#elif JUCE_WASM\n #include "native/juce_SystemStats_wasm.cpp"',
		`#elif JUCE_WASM\n #include "native/juce_CommonFile_linux.cpp"\n ${install('juce_core', 'juce_headless_core')}\n #include "native/juce_SystemStats_wasm.cpp"`);
	patch(core, ' #if JUCE_WASM\n  #include <stdio.h>',
		' #if JUCE_WASM\n  #include <dirent.h>\n  #include <fnmatch.h>\n  #include <sys/mman.h>\n  #include <sys/statvfs.h>\n  #include <stdio.h>');
	const posix = 'juce_core/native/juce_SharedCode_posix.h';
	// Emscripten supplies directory metadata and mmap over its virtual filesystem.
	patch(posix, '#if ! JUCE_WASM\nvoid MemoryMappedFile::openInternal', 'void MemoryMappedFile::openInternal');
	patch(posix, '\nFile juce_getExecutableFile()\n{', '\n#if ! JUCE_WASM\nFile juce_getExecutableFile()\n{');
	patch(posix, '            madvise (m, (size_t) range.getLength(), MADV_SEQUENTIAL);',
		'           #if ! JUCE_WASM\n            madvise (m, (size_t) range.getLength(), MADV_SEQUENTIAL);\n           #endif');
	patch(posix, '   #if JUCE_MAC || JUCE_IOS\n    static int64 getCreationTime',
		'   #endif\n\n   #if JUCE_MAC || JUCE_IOS\n    static int64 getCreationTime');
	patch(posix, '   #endif\n\n    Result getResultForErrno()', '\n    Result getResultForErrno()');
	patch(posix, '#if defined (CPU_ISSET) && ! defined (SUPPORT_AFFINITIES)',
		'#if ! JUCE_WASM && defined (CPU_ISSET) && ! defined (SUPPORT_AFFINITIES)');
	patch('juce_core/native/juce_CommonFile_linux.cpp', 'fnmatch (wildcardUTF8, de->d_name, FNM_CASEFOLD)',
		'fnmatch (wildcardUTF8, de->d_name, 0)');
	const time = 'juce_core/time/juce_Time.cpp';
	patch(time, '#if JUCE_ANDROID\n        using StringType', '#if JUCE_ANDROID || JUCE_WASM\n        using StringType');
	patch(time, '#if JUCE_ANDROID\n                        strftime', '#if JUCE_ANDROID || JUCE_WASM\n                        strftime');

	patch('juce_data_structures/app_properties/juce_PropertiesFile.cpp', '#elif JUCE_LINUX || JUCE_BSD || JUCE_ANDROID',
		'#elif JUCE_WASM\n    auto dir = File ("/tmp").getChildFile (folderName.isEmpty() ? applicationName : folderName);\n   #elif JUCE_LINUX || JUCE_BSD || JUCE_ANDROID');
	patch('juce_audio_processors/utilities/juce_PluginHostType.cpp', '#elif JUCE_IOS\n   #elif JUCE_ANDROID\n   #else\n    #error',
		'#elif JUCE_IOS || JUCE_ANDROID || JUCE_WASM\n   #else\n    #error');
	patch('juce_events/juce_events.cpp', '#include "native/juce_Messaging_android.cpp"',
		`#include "native/juce_Messaging_android.cpp"\n#elif JUCE_WASM\n ${install('juce_events', 'juce_headless_messaging')}`);
	patch('juce_gui_basics/juce_gui_basics.cpp', '#include "mouse/juce_MouseCursor.cpp"',
		`#if JUCE_WASM\n ${install('juce_gui_basics', 'juce_headless_windowing')}\n#endif\n#include "mouse/juce_MouseCursor.cpp"`);
	appendPlatform('juce_audio_devices', 'juce_headless_midi');
	appendPlatform('juce_graphics', 'juce_headless_graphics');

	// The buffered block's alignment, rather than the pointer's width, protects
	// the low bit checked by the pinned reader.
	replaceWasmSource(workspace, 'tracktion/modules/tracktion_engine/audio_files/tracktion_BufferedFileReader.cpp',
		'static_assert (alignof (BufferedBlock*) >= 8);', 'static_assert (alignof (BufferedBlock) >= 2);');
}
