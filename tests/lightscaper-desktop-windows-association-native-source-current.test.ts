/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../native/lightscaper-desktop-association-current-v1/windows/', import.meta.url);
const source = (name: string) => readFile(new URL(name, ROOT), 'utf8');

test('Windows association resolves the actual per-user default and opens only the genuine archive', async () => {
	const [main, owner] = await Promise.all([source('main.cpp'), source('association.hpp')]);
	assert.match(owner, /AssocQueryStringW\(flags, selector, extension, L"open"/u);
	assert.match(owner, /query\(extension, ASSOCSTR_EXECUTABLE\).*query\(extension, ASSOCSTR_PROGID\).*query\(extension, ASSOCSTR_COMMAND\)/su);
	assert.match(main, /association\(L"\.liscape"\)/u);
	assert.match(main, /Software\\\\Classes\\\\\.liscape/u);
	assert.match(main, /UserChoice", L"ProgId"/u);
	assert.match(main, /required\(out\.userCommand\) == required\(out\.selected\.command\)/u);
	assert.match(main, /launch\.fMask = SEE_MASK_NOASYNC \| SEE_MASK_NOCLOSEPROCESS \| SEE_MASK_FLAG_NO_UI/u);
	assert.match(main, /launch\.lpVerb = L"open"; launch\.lpFile = out\.input\.archive\.c_str\(\)/u);
	assert.match(main, /ShellExecuteExW\(&launch\)/u);
	for (const forbidden of [/CreateProcess[AW]?\s*\(/u, /launch\.(?:lpClass|hkeyClass|lpParameters)\s*=/u,
		/SEE_MASK_(?:CLASSNAME|CLASSKEY|INVOKEIDLIST|NOZONECHECKS)/u, /Reg(?:Set|Create|Delete)[A-Za-z0-9_]*\s*\(/u]) {
		assert.doesNotMatch(main + owner, forbidden);
	}
	for (const extension of ['.sscape', '.fscape', '.scape']) assert.ok(main.includes(`L"${extension}"`));
	assert.match(main, /same\(out\.foreignBefore\[i\], out\.foreignAfter\[i\]\)/u);
});


test('Windows association admits exactly the installed NSIS catalog FILECLASS', async () => {
	const [owner, config, generator, macro] = await Promise.all([
		source('association.hpp'), readFile(new URL('../electron-builder.lightscaper.config.cjs', import.meta.url), 'utf8'),
		readFile(new URL('../node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js', import.meta.url), 'utf8'),
		readFile(new URL('../node_modules/app-builder-lib/templates/nsis/include/FileAssociation.nsh', import.meta.url), 'utf8'),
	]);
	assert.match(config, /fileAssociations:\s*\[\{\s*ext: 'liscape',\s*name: 'Lightscaper Catalog',/u);
	assert.match(generator, /insertMacro\("APP_ASSOCIATE",[^\n]*item\.name \|\| ext/u);
	assert.ok(macro.includes('WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}" "" "${FILECLASS}"'));
	assert.ok(macro.includes('Software\\Classes\\${FILECLASS}\\shell\\open\\command'));
	assert.match(owner, /require\(value == L"Lightscaper Catalog", "progid-not-owned"\)/u);
	assert.doesNotMatch(owner, /progid-character/u);
});

test('Windows association proves the held secondary identity and the exact calling Job, then actual retirement', async () => {
	const [main, owner] = await Promise.all([source('main.cpp'), source('association.hpp')]);
	assert.match(owner, /QueryInformationJobObject\(nullptr, JobObjectBasicProcessIdList/u);
	assert.match(owner, /list\.assigned == list\.count/u);
	assert.match(owner, /binary_search\(result\.begin\(\), result\.end\(\), GetCurrentProcessId\(\)\)/u);
	assert.match(main, /out\.opened\.pid != out\.primary\.pid && out\.opened\.created >= dispatchTime/u);
	assert.match(main, /inJob != FALSE && std::binary_search\(out\.jobAtDispatch\.begin\(\), out\.jobAtDispatch\.end\(\), out\.opened\.pid\)/u);
	assert.match(main, /require\(out\.sameCallingJob, "returned-process-outside-calling-job"\)/u);
	assert.match(main, /shell-returned-no-process-handle/u);
	assert.match(main, /WaitForSingleObject\(opened\.get\(\), 30000u\)/u);
	assert.match(main, /GetExitCodeProcess\(opened\.get\(\), &out\.exitCode\)/u);
	assert.match(main, /out\.naturalExit = out\.exitCode == 0u/u);
	assert.match(main, /joinedChildren\(5000u\)/u);
	assert.match(main, /out\.primaryStillLive = WaitForSingleObject\(primary\.get\(\), 0u\) == WAIT_TIMEOUT/u);
	assert.doesNotMatch(main + owner, /(?:TerminateProcess|TerminateJobObject|AssignProcessToJobObject|CreateJobObject)[AW]?\s*\(/u);
});

test('Windows association request, custody and result publication retain finite closed boundaries', async () => {
	const [main, protocol, files] = await Promise.all([source('main.cpp'), source('protocol.hpp'), source('files.hpp')]);
	assert.match(protocol, /array<const char \*, 9> names/u);
	for (const field of ['schemaVersion', 'nonce', 'target', 'sourceRevision', 'operation', 'executablePath', 'archivePath', 'archiveSha256', 'primaryPid']) {
		assert.ok(protocol.includes(`"${field}"`));
	}
	assert.match(protocol, /fields\.emplace\(key, value\)\.second/u);
	assert.match(protocol, /at == bytes\.size\(\), "json-trailing"/u);
	assert.match(protocol, /value\.target == LIGHTSCAPER_ASSOCIATION_TARGET/u);
	assert.match(protocol, /bytes\.size\(\) <= 65536u/u);
	assert.match(files, /FILE_FLAG_OPEN_REPARSE_POINT/u);
	assert.match(files, /GetFileType\(file\) == FILE_TYPE_DISK/u);
	assert.match(files, /value\.nNumberOfLinks == 1u/u);
	assert.match(main, /digest\(archive\.get\(\), cleanup\) == out\.input\.digest/u);
	assert.match(main, /same\(before, info\(archive\.get\(\)\)\)/u);
	assert.match(main, /\.windows-association-request\.json/u);
	assert.match(main, /\.windows-association-result\.json/u);
	assert.match(files, /CREATE_NEW/u);
	assert.match(files, /FlushFileBuffers\(file\.get\(\)\)/u);
	assert.match(main, /Result output\(outputPath, cleanup\);[\s\S]*request\(readFile\(input\.get\(\)\)\)/u);
	assert.match(main, /digest\(archive\.get\(\), cleanup\)[\s\S]*jobProcesses\(\)[\s\S]*Com com;[\s\S]*association\(L"\.liscape"\)/u);
	assert.match(main, /output\.publish\(receipt\(out, cleanup\)\)/u);
	assert.match(main, /return out\.complete && cleanup\.okay \? 0 : 1/u);
});

test('Windows association build admits only native maintained x64 and ARM64 targets without new dependencies', async () => {
	const cmake = await source('CMakeLists.txt');
	assert.match(cmake, /NOT WIN32 OR NOT MSVC/u);
	assert.match(cmake, /STREQUAL "win-x64"/u);
	assert.match(cmake, /STREQUAL "win-arm64"/u);
	assert.match(cmake, /NOT CMAKE_SIZEOF_VOID_P EQUAL 8/u);
	assert.match(cmake, /cxx_std_17/u);
	assert.match(cmake, /\/W4 \/WX \/permissive- \/utf-8/u);
	assert.match(cmake, /PRIVATE kernel32 shell32 shlwapi ole32 advapi32 bcrypt/u);
	assert.doesNotMatch(cmake, /FetchContent|ExternalProject|find_package|COMMAND.*(?:npm|curl|powershell)/iu);
});
