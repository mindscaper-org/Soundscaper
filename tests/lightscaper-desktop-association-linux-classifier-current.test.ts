/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchLightscaperManagedSmokeProcessCurrentV1 as launch } from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';

const MIME = 'application/vnd.lightscaper.liscape+zip';
const SOURCE = new URL('../native/lightscaper-desktop-association-current-v1/linux/', import.meta.url);

void test('the actual GIO classifier admits only its own file type and refuses a foreign desktop before any launch', {
	skip: process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch), timeout: 180_000,
}, async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-gio-classifier-')));
	let retired = true;
	try {
		async function joined(executable: string, args: readonly string[], deadlineMs: number) {
			retired = false;
			const value = await launch(executable, args, { deadlineMs, retirementGraceMs: 1_000 });
			retired = value.readersRetired && value.unretiredOwnedGroupId === null;
			assert.equal(value.launchError, null, value.stderr); assert.equal(value.expired, false);
			assert.equal(value.signal, null); assert.equal(value.readersRetired, true);
			assert.equal(value.forcedGroupRetirement, false); assert.deepEqual(value.liveReaderIds, []);
			assert.equal(value.unretiredOwnedGroupId, null); assert.equal(value.exitCode, 0, value.stdout + value.stderr);
			return value;
		}
		const source = fileURLToPath(SOURCE), strictJson = fileURLToPath(new URL('../native/framescaper-media-host/src/', import.meta.url));
		await writeFile(join(root, 'fixture.cpp'), CLASSIFIER, { flag: 'wx', mode: 0o600 });
		await writeFile(join(root, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.20)
project(LightscaperActualGioClassifier LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(PkgConfig REQUIRED)
pkg_check_modules(GIO REQUIRED IMPORTED_TARGET gio-unix-2.0>=2.58)
add_executable(classifier-fixture fixture.cpp "${strictJson}/strict_json.cpp")
target_include_directories(classifier-fixture PRIVATE "${source}" "${strictJson}")
target_link_libraries(classifier-fixture PRIVATE PkgConfig::GIO)
target_compile_options(classifier-fixture PRIVATE -Wall -Wextra -Werror)
`, { flag: 'wx', mode: 0o600 });
		const build = join(root, 'build');
		await joined('cmake', ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Release'], 30_000);
		await joined('cmake', ['--build', build, '--target', 'classifier-fixture', '--parallel', '2'], 60_000);
		const executable = join(build, 'classifier-fixture'), data = join(root, 'data'), applications = join(data, 'applications');
		for (const path of [applications, join(data, 'mime/packages'), join(root, 'config'), join(root, 'system-config')]) {
			await mkdir(path, { recursive: true, mode: 0o700 });
		}
		const desktop = (name: string) => `[Desktop Entry]\nType=Application\nName=${name}\nExec=${executable} %U\nTerminal=false\nMimeType=${MIME};\n`;
		await writeFile(join(applications, 'org.lightscaper.desktop'), desktop('Lightscaper'), { mode: 0o600 });
		await writeFile(join(applications, 'org.foreign.desktop'), desktop('Foreign'), { mode: 0o600 });
		await writeFile(join(data, 'mime/packages/lightscaper.xml'), `<?xml version="1.0"?><mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="${MIME}"><glob pattern="*.liscape"/></mime-type></mime-info>`, { mode: 0o600 });
		await joined('update-mime-database', [join(data, 'mime')], 15_000);
		// A real ZIP is used only to exercise type classification; it is not a valid product archive or OS-open witness.
		const bytes = zipSync({ 'diagnostic.txt': new Uint8Array([1, 2, 3]) });
		await writeFile(join(root, 'owned.liscape'), bytes, { mode: 0o600 });
		await writeFile(join(root, 'wrong.zip'), bytes, { mode: 0o600 });
		for (const mode of ['own', 'wrong-type', 'foreign-handler'] as const) {
			const id = mode === 'foreign-handler' ? 'org.foreign.desktop' : 'org.lightscaper.desktop';
			await writeFile(join(root, 'config/mimeapps.list'), `[Default Applications]\n${MIME}=${id};\n`, { mode: 0o600 });
			// Private user data/defaults coexist with inherited system MIME directories and real ZIP magic, as in production.
			const receipt = await joined(executable, [mode, root, executable], 10_000);
			const result: unknown = JSON.parse(receipt.stdout); assert.ok(result && typeof result === 'object');
			assert.ok('contentType' in result && typeof result.contentType === 'string');
			if (mode === 'wrong-type') assert.notEqual(result.contentType, MIME);
			assert.deepEqual(result, { status: 'passed', mode, accepted: mode === 'own',
				contentType: mode === 'wrong-type' ? 'application/zip' : MIME,
				defaultId: mode === 'wrong-type' ? null : id,
				contentTypeQueries: 1, defaultHandlerQueries: mode === 'wrong-type' ? 0 : 1,
				launchCalls: 0, pidCallbacks: 0 });
		}
	} finally {
		if (retired) await rm(root, { recursive: true, force: true });
		else context.diagnostic(`Actual GIO classifier group/readers are unproved; retaining ${root}`);
	}
});

const CLASSIFIER = String.raw`/* SPDX-License-Identifier: AGPL-3.0-only */
#define main association_program_entry
#include "main.cpp"
#undef main
#include <cstdlib>

int main(int argc, char* argv[]) {
  try {
    require(argc == 4, "Expected mode, owned fixture root and actual fixture executable.");
    const std::string mode(argv[1]), root(argv[2]), executable(argv[3]);
    require(mode == "own" || mode == "wrong-type" || mode == "foreign-handler", "Unknown classifier control.");
    for (const auto& entry : std::vector<std::pair<std::string, std::string>>{
      {"XDG_DATA_HOME", root + "/data"},
      {"XDG_CONFIG_HOME", root + "/config"}, {"XDG_CONFIG_DIRS", root + "/system-config"}})
      require(setenv(entry.first.c_str(), entry.second.c_str(), 1) == 0, "Private XDG fixture environment failed.");
    request input{}; input.executable = executable;
    const auto path = root + (mode == "wrong-type" ? "/wrong.zip" : "/owned.liscape");
    std::unique_ptr<GFile, decltype(&g_object_unref)> file(g_file_new_for_path(path.c_str()), g_object_unref);
    counters count; object report; bool accepted = false; std::string failure;
    try { auto selected = resolve_default(file.get(), input, count, report); require(selected.content_type == mime, "Selected type differs."); accepted = true; }
    catch (const std::exception& error) { failure = error.what(); }
    require(accepted == (mode == "own"), "Actual classifier acceptance differs.");
    if (mode == "wrong-type") require(failure == "Actual archive content type is not the product-owned catalog MIME.", "Wrong-type refusal differs.");
    if (mode == "foreign-handler") require(failure == "Selected desktop name/type is foreign.", "Foreign-metadata refusal differs.");
    require(count.content == 1 && count.defaults == (mode == "wrong-type" ? 0u : 1u) && count.launches == 0 && count.callbacks == 0,
      "Classifier control reached an OS launch or skipped actual queries.");
    const auto content = report.find("contentType"), id = report.find("desktopId");
    object result{{"status", quote("passed")}, {"mode", quote(mode)}, {"accepted", accepted ? "true" : "false"},
      {"contentType", content == report.end() ? "null" : content->second}, {"defaultId", id == report.end() ? "null" : id->second},
      {"contentTypeQueries", std::to_string(count.content)}, {"defaultHandlerQueries", std::to_string(count.defaults)},
      {"launchCalls", std::to_string(count.launches)}, {"pidCallbacks", std::to_string(count.callbacks)}};
    std::cout << encode(result) << '\n'; return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
`;
