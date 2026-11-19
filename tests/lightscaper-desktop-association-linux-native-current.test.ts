/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchLightscaperManagedSmokeProcessCurrentV1 as launch } from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';

const SOURCE = new URL('../native/lightscaper-desktop-association-current-v1/linux/', import.meta.url);

void test('Linux association helper resolves the real archive default and owns every native launcher child', async () => {
	const source = await readFile(new URL('main.cpp', SOURCE), 'utf8'), processes = await readFile(new URL('process.hpp', SOURCE), 'utf8');
	assert.match(source, /g_file_query_info\(archive, G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE/u);
	assert.match(source, /g_file_query_default_handler\(archive,/u);
	assert.match(source, /g_desktop_app_info_launch_uris_as_manager\(/u);
	assert.match(source, /G_SPAWN_DO_NOT_REAP_CHILD, nullptr, nullptr, launched, &launch/u);
	assert.doesNotMatch(source, /g_desktop_app_info_new(?:_from_filename|_from_keyfile)?\(|g_app_info_set_as_default|g_app_info_launch_default_for_uri/u);
	assert.match(processes, /readlink\(\(root \+ "\/exe"\)/u);
	assert.match(processes, /getpgid\(pid\)/u);
	assert.match(processes, /waitpid\(value\.pid, &value\.status, WNOHANG\)/u);
	assert.match(processes, /g_spawn_close_pid\(value\.pid\)/u);
	assert.doesNotMatch(processes, /waitpid\([^\n]+, 0\)/u);
	const reservation = source.indexOf('output.value = open(output_path.c_str()');
	assert.ok(reservation >= 0 && reservation < source.indexOf('perform(input, report, count, launch);'));
});

void test('target-native Linux helper compiles and refuses malformed or unowned dispatch without an OS opener side effect', {
	skip: process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch), timeout: 180_000,
}, async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-linux-association-refusals-')));
	let safeToRemove = false;
	try {
		async function joined(executable: string, args: readonly string[], deadlineMs: number) {
			safeToRemove = false;
			const receipt = await launch(executable, args, { deadlineMs, retirementGraceMs: 1_000 });
			safeToRemove = receipt.readersRetired && receipt.unretiredOwnedGroupId === null;
			assert.equal(receipt.launchError, null, receipt.stderr); assert.equal(receipt.expired, false);
			assert.equal(receipt.signal, null); assert.equal(receipt.readersRetired, true);
			assert.equal(receipt.forcedGroupRetirement, false); assert.deepEqual(receipt.liveReaderIds, []);
			assert.equal(receipt.unretiredOwnedGroupId, null); return receipt;
		}
		const build = join(root, 'build');
		const configured = await joined('cmake', ['-S', fileURLToPath(SOURCE), '-B', build, '-DCMAKE_BUILD_TYPE=Release'], 60_000);
		assert.equal(configured.exitCode, 0, configured.stderr);
		const built = await joined('cmake', ['--build', build, '--target', 'lightscaper-desktop-association-current-v1', '--parallel', '2'], 90_000);
		assert.equal(built.exitCode, 0, built.stderr);
		const helper = join(build, 'lightscaper-desktop-association-current-v1'), executable = join(root, 'lightscaper');
		// This real compiled binary is only an input to refusal cases, never a fake Lightscaper OS positive.
		await copyFile(helper, executable); await chmod(executable, 0o755);
		const archive = join(root, 'owned.liscape'), body = Buffer.from([3, 7, 11]);
		await writeFile(archive, body, { mode: 0o600 });
		const base = { schemaVersion: 1, nonce: 'a'.repeat(32), target: `linux-${process.arch}`,
			sourceRevision: 'b'.repeat(40), operation: 'open', executablePath: executable, archivePath: archive,
			archiveSha256: createHash('sha256').update(body).digest('hex'), primaryPid: process.pid };
		let ordinal = 0;
		async function refused(request: Readonly<Record<string, unknown>>, expected: RegExp, raw?: string): Promise<void> {
			const input = join(root, `request-${++ordinal}.json`), output = join(root, `result-${ordinal}.json`);
			await writeFile(input, raw ?? JSON.stringify(request), { flag: 'wx', mode: 0o600 });
			const receipt = await joined(helper, ['--request', input, '--result', output], 10_000);
			const retired = safeToRemove; safeToRemove = false;
			assert.equal(receipt.exitCode, 1, receipt.stderr);
			const result = record(JSON.parse(await readFile(output, 'utf8')) as unknown);
			assert.equal(result.status, 'failed'); assert.equal(result.secondary, null);
			assert.match(String(record(result.error).message), expected);
			assert.deepEqual(result.counters, { contentTypeQueries: 0, defaultHandlerQueries: 0, launchCalls: 0, pidCallbacks: 0 });
			safeToRemove = retired;
		}
		await refused({ ...base, extra: true }, /closed nine-key/u);
		await refused({ ...base, schemaVersion: true }, /wrong JSON type/u);
		await refused(base, /duplicate JSON object key/u, JSON.stringify(base).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
		await refused({ ...base, archiveSha256: '0'.repeat(64) }, /Archive SHA differs/u);
		await refused(base, /Actual process executable differs/u);
		await refused({ ...base, primaryPid: 0 }, /identity is invalid/u);
		const alias = join(root, 'alias'); await symlink(executable, alias);
		await refused({ ...base, executablePath: alias }, /Symlink or noncanonical/u);
		const other = join(root, 'foreign.sscape'); await writeFile(other, body, { mode: 0o600 });
		await refused({ ...base, archivePath: other }, /owned catalog suffix/u);
		const input = join(root, 'collision-request.json'), output = join(root, 'collision-result.json');
		await writeFile(input, JSON.stringify(base), { mode: 0o600 }); await writeFile(output, 'retained-result', { mode: 0o600 });
		const collision = await joined(helper, ['--request', input, '--result', output], 10_000);
		const retired = safeToRemove; safeToRemove = false;
		assert.equal(collision.exitCode, 2); assert.equal(await readFile(output, 'utf8'), 'retained-result');
		const refusal = record(JSON.parse(collision.stderr) as unknown);
		assert.equal(refusal.schemaVersion, 1); assert.equal(refusal.kind, 'lightscaper-linux-association-no-result-refusal');
		assert.deepEqual(refusal.counters, { contentTypeQueries: 0, defaultHandlerQueries: 0, launchCalls: 0, pidCallbacks: 0 });
		safeToRemove = retired;
	} finally {
		if (safeToRemove) await rm(root, { recursive: true, force: true });
		else context.diagnostic(`Actual native process-group retirement was not proved; owned fixture retained: ${root}`);
	}
});

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}


void test('actual GIO callback pins a pre-exec child and captures only its later exact executable', {
	skip: process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch), timeout: 120_000,
}, async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-linux-child-exec-')));
	let retired = true;
	try {
		async function joined(executable: string, args: readonly string[], deadlineMs: number) {
			retired = false;
			const receipt = await launch(executable, args, { deadlineMs, retirementGraceMs: 1_000 });
			retired = receipt.readersRetired && receipt.unretiredOwnedGroupId === null;
			assert.equal(receipt.launchError, null, receipt.stderr); assert.equal(receipt.expired, false);
			assert.equal(receipt.signal, null); assert.equal(receipt.readersRetired, true);
			assert.equal(receipt.forcedGroupRetirement, false); assert.deepEqual(receipt.liveReaderIds, []);
			assert.equal(receipt.unretiredOwnedGroupId, null); return receipt;
		}
		const source = fileURLToPath(SOURCE), strictJson = fileURLToPath(new URL('../native/framescaper-media-host/src/', import.meta.url));
		await writeFile(join(root, 'fixture.cpp'), EXEC_CAPTURE_FIXTURE, { flag: 'wx', mode: 0o600 });
		await writeFile(join(root, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.20)
project(LightscaperActualChildExec LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(PkgConfig REQUIRED)
pkg_check_modules(GIO REQUIRED IMPORTED_TARGET gio-unix-2.0>=2.58)
add_executable(exec-fixture fixture.cpp "${strictJson}/strict_json.cpp")
target_include_directories(exec-fixture PRIVATE "${source}" "${strictJson}")
target_link_libraries(exec-fixture PRIVATE PkgConfig::GIO)
target_compile_options(exec-fixture PRIVATE -Wall -Wextra -Werror)
`, { flag: 'wx', mode: 0o600 });
		const build = join(root, 'build');
		const configured = await joined('cmake', ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Release'], 30_000);
		assert.equal(configured.exitCode, 0, configured.stderr);
		const compiled = await joined('cmake', ['--build', build, '--target', 'exec-fixture', '--parallel', '2'], 60_000);
		assert.equal(compiled.exitCode, 0, compiled.stderr);
		const fixture = join(build, 'exec-fixture'), target = join(root, 'actual-exec-target');
		await copyFile(fixture, target); await chmod(target, 0o755);
		for (const mode of ['delayed', 'wrong', 'retired', 'group']) {
			const receipt = await joined(fixture, [mode, target], 5_000);
			assert.equal(receipt.exitCode, 0, receipt.stdout + receipt.stderr);
			const result = record(JSON.parse(receipt.stdout) as unknown);
			assert.equal(result.status, 'passed'); assert.equal(result.mode, mode);
			assert.equal(result.callbackCount, 1); assert.equal(result.childrenRetired, true); assert.equal(result.error, '');
		}
	} finally {
		if (retired) await rm(root, { recursive: true, force: true });
		else context.diagnostic(`Actual callback fixture group/readers are unproved; retaining ${root}`);
	}
});

const EXEC_CAPTURE_FIXTURE = String.raw`/* SPDX-License-Identifier: AGPL-3.0-only */
#define main association_program_entry
#include "main.cpp"
#undef main
#include <cstdlib>

// Real fork/exec lifecycle only. This fixture does not register or launch an OS default.
template<class T> static void actual_capture(T& value, const std::string& executable, unsigned timeout) {
  if constexpr (requires { capture_exec(value, executable, getpgrp(), timeout); })
    capture_exec(value, executable, getpgrp(), timeout);
  else throw std::runtime_error("Actual child-exec capture owner is unavailable.");
}
static void release(int& pipe) {
  if (pipe >= 0) { const char token = 'x'; const auto sent = write(pipe, &token, 1); (void)sent; close(pipe); pipe = -1; }
}
static void gate(int descriptor) {
  char token{}; ssize_t count;
  do { count = read(descriptor, &token, 1); } while (count < 0 && errno == EINTR);
  close(descriptor); _exit(count == 1 ? 0 : 9);
}
int main(int argc, char* argv[]) {
  if (argc == 3 && std::string(argv[1]) == "--target") gate(std::atoi(argv[2]));
  if (argc != 3) return 2;
  const std::string mode(argv[1]), executable(argv[2]); int start[2]{-1,-1}, finish[2]{-1,-1};
  (void)signal(SIGPIPE, SIG_IGN);
  launch_state state; counters count; request input; input.executable = executable;
  GDesktopAppInfo* app = nullptr; bool passed = false; std::string message;
  try {
    require(mode == "delayed" || mode == "wrong" || mode == "retired" || mode == "group", "Unknown fixture mode.");
    GKeyFile* metadata = g_key_file_new();
    g_key_file_set_string(metadata, "Desktop Entry", "Type", "Application");
    g_key_file_set_string(metadata, "Desktop Entry", "Name", "Private fork-exec callback fixture");
    g_key_file_set_string(metadata, "Desktop Entry", "Exec", executable.c_str());
    app = g_desktop_app_info_new_from_keyfile(metadata); g_key_file_unref(metadata);
    require(app != nullptr, "Actual callback fixture app object unavailable.");
    require(pipe(start) == 0 && pipe(finish) == 0, "Actual fixture pipes unavailable.");
    const auto pid = fork(); require(pid >= 0, "Actual fixture fork failed.");
    if (pid == 0) {
      close(start[1]); close(finish[1]); char token{}; ssize_t received;
      do { received = read(start[0], &token, 1); } while (received < 0 && errno == EINTR);
      close(start[0]); if (received != 1) _exit(8);
      if (mode == "retired") _exit(0);
      if (mode == "group") { if (setpgid(0, 0) != 0) _exit(7); gate(finish[0]); }
      if (mode == "wrong") gate(finish[0]);
      (void)poll(nullptr, 0, 100);
      const auto descriptor = std::to_string(finish[0]);
      execl(executable.c_str(), executable.c_str(), "--target", descriptor.c_str(), static_cast<char*>(nullptr)); _exit(6);
    }
    close(start[0]); start[0] = -1; close(finish[0]); finish[0] = -1;
    state.input = &input; state.expected = G_APP_INFO(app); state.group = getpgrp(); state.count = &count;
    // Invoke the actual production callback while the real direct child is held before exec.
    launched(app, pid, &state); release(start[1]);
    if (state.failure) std::rethrow_exception(state.failure);
    require(state.children.size() == 1 && count.callbacks == 1, "Actual callback PID was not retained exactly once.");
    auto& child = state.children.front(); const auto pinned = child.identity;
    require(!child.captured && pinned.pid == pid && pinned.executable != executable, "Pre-exec image was claimed as the app.");
    std::string refusal;
    try { actual_capture(child, executable, mode == "delayed" ? 1000 : 250); }
    catch (const std::exception& error) { refusal = error.what(); }
    if (mode == "delayed") {
      require(refusal.empty() && child.captured && child.identity.executable == executable && child.identity.start == pinned.start &&
        child.identity.group == pinned.group, "Delayed actual exec did not preserve exact child identity: " + refusal);
    } else {
      const auto expected = mode == "wrong" ? "bounded deadline" : mode == "group" ? "identity changed" : "retired";
      // An exiting child can lose /proc/exe between the state and image reads.
      // The actual zero exit/reap below proves retirement independently of its error text.
      require(!child.captured && !refusal.empty() && (mode == "retired" || refusal.find(expected) != std::string::npos),
        "Wrong child transition was not refused: " + refusal);
    }
    release(finish[1]); require(reap(child, 1000) && child.closed && WIFEXITED(child.status) && WEXITSTATUS(child.status) == 0,
      "Fixture child did not naturally retire and close its native PID.");
    passed = true;
  } catch (const std::exception& error) { message = error.what(); }
  release(start[1]); release(finish[1]);
  const auto joined = cleanup(state); if (app) g_object_unref(app);
  if (start[0] >= 0) close(start[0]);
  if (finish[0] >= 0) close(finish[0]);
  std::cout << encode({{"status", quote(passed && joined ? "passed" : "failed")}, {"mode", quote(mode)},
    {"callbackCount", std::to_string(count.callbacks)}, {"childrenRetired", joined ? "true" : "false"}, {"error", quote(message)}}) << '\n';
  return passed && joined ? 0 : 1;
}
`;
