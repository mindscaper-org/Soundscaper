/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { desktopLlamaCppBuildPlan } from '../scripts/lib/desktop-assistance-llama-runtime.mjs';
import * as companion from '../scripts/lib/desktop-assistance-vulkan-companion.mjs';
import { desktopWhisperCppBuildPlan } from '../scripts/lib/desktop-assistance-whisper-runtime.mjs';

const runFile = promisify(execFile);
// Exact emission loop shared by the two pinned upstream shader generators.
const arrayEmbedding = String.raw`            src << "const unsigned char " << name << "_data[" << data.size() << "] = {\n" << std::hex;
            auto bytes = reinterpret_cast<const uint8_t*>(data.data());
            for (size_t i = 0; i < data.size(); ++i) {
                src << "0x" << static_cast<int>(bytes[i]) << ",";
                if ((i + 1) % 12 == 0) src << "\n";
            }
            src << std::dec << "\n};\n\n";`;

for (const [name, makePlan] of [
	['Whisper', desktopWhisperCppBuildPlan], ['llama', desktopLlamaCppBuildPlan],
] as const) {
	test(`${name} ARM64 CPU and Vulkan builds share a four-process ClangCL compilation limit`, () => {
		for (const architecture of ['x64', 'arm64']) {
			const plan = makePlan({ targetId: 'win-arm64', platform: 'win32', architecture });
			assert.ok(plan.configureArgs.includes('ClangCL'));
			assert.deepEqual(plan.executionProviders, ['vulkan', 'cpu']);
			assert.ok(plan.vulkanConfigureArgs);
			for (const args of [plan.configureArgs, plan.vulkanConfigureArgs]) {
				const settings = args.filter((arg: string) => arg.startsWith('-DCMAKE_VS_GLOBALS='));
				assert.equal(settings.length, 1);
				const properties = new Map(settings[0].slice('-DCMAKE_VS_GLOBALS='.length).split(';')
					.map((setting: string) => setting.split('=') as [string, string]));
				assert.equal(properties.get('UseMultiToolTask'), 'true');
				assert.equal(properties.get('EnforceProcessCountAcrossBuilds'), 'true');
				assert.equal(properties.get('MultiProcMaxCount'), '4');
				assert.equal(properties.get('CL_MPCount'), '4');
			}
		}
		for (const [targetId, platform, architecture] of [
			['win-x64', 'win32', 'x64'], ['linux-x64', 'linux', 'x64'],
			['linux-arm64', 'linux', 'arm64'], ['mac-arm64', 'darwin', 'arm64'],
		]) {
			const plan = makePlan({ targetId, platform, architecture });
			assert.equal(plan.configureArgs.some((arg: string) => arg.startsWith('-DCMAKE_VS_GLOBALS=')), false);
		}
	});
}

test('shader string embedding rejects missing, duplicated, and already patched source contexts', () => {
	const patched = companion.patchGgmlVulkanShaderEmbedding(arrayEmbedding);
	assert.throws(() => companion.patchGgmlVulkanShaderEmbedding('different upstream loop'), /exact source/u);
	assert.throws(() => companion.patchGgmlVulkanShaderEmbedding(`${arrayEmbedding}\n${arrayEmbedding}`), /exact source/u);
	assert.throws(() => companion.patchGgmlVulkanShaderEmbedding(patched), /exact source/u);
});

test('generated shader strings compile and preserve every byte and the original shader length', async context => {
	const root = await mkdtemp(join(tmpdir(), 'arm64 shader embedding '));
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
	const source = join(root, 'source');
	const build = join(root, 'build');
	await mkdir(source);
	// Include every byte, embedded NULs, hex digits, quotes, backslashes, and
	// multiple literal boundaries with a final partial chunk.
	const expected = Buffer.from(Array.from({ length: 4099 }, (_, index) => index % 256));
	await writeFile(join(source, 'shader.bin'), expected);
	await writeFile(join(source, 'writer.cpp'), companion.patchGgmlVulkanShaderEmbedding(String.raw`
#include <cstdint>
#include <fstream>
#include <iterator>
#include <string>
int main(int argc, char **argv) {
    if (argc != 3) return 1;
    std::ifstream input(argv[1], std::ios::binary);
    const std::string data((std::istreambuf_iterator<char>(input)), {});
    const std::string name = "shader";
    std::ofstream src(argv[2], std::ios::binary);
    src << "#include <cstdint>\n#include <iostream>\nextern const unsigned char shader_data[];\n";
    src << "const uint64_t " << name << "_len = " << data.size() << ";\n";
${arrayEmbedding}
    src << "int main() { std::cout.write(reinterpret_cast<const char *>(shader_data), shader_len);"
           " return shader_data[shader_len] == 0 && reinterpret_cast<uintptr_t>(shader_data) % 4 == 0 ? 0 : 1; }\n";
    return src.good() ? 0 : 1;
}
`));
	await writeFile(join(source, 'CMakeLists.txt'), `
cmake_minimum_required(VERSION 3.20)
project(shader_embedding_fixture LANGUAGES CXX)
add_executable(shader-writer writer.cpp)
add_custom_command(OUTPUT "\${CMAKE_CURRENT_BINARY_DIR}/generated.cpp"
    COMMAND shader-writer "\${CMAKE_CURRENT_SOURCE_DIR}/shader.bin" "\${CMAKE_CURRENT_BINARY_DIR}/generated.cpp"
    DEPENDS shader-writer "\${CMAKE_CURRENT_SOURCE_DIR}/shader.bin")
add_executable(shader-roundtrip "\${CMAKE_CURRENT_BINARY_DIR}/generated.cpp")
`);
	await runFile('cmake', ['-S', source, '-B', build], { timeout: 30_000 });
	await runFile('cmake', ['--build', build, '--config', 'Release', '--parallel', '2'], { timeout: 60_000 });
	const executable = process.platform === 'win32' ? join(build, 'Release', 'shader-roundtrip.exe')
		: join(build, 'shader-roundtrip');
	const { stdout } = await runFile(executable, [], { encoding: 'buffer', timeout: 10_000 });
	assert.deepEqual(stdout, expected);
});
