/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RECEIPT_SOURCE = `
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// Diagnostic proof records completed model graph work, never device discovery.
static void scape_gpu_compute_receipt(ggml_backend_sched_t sched, ggml_cgraph * graph) {
    const char * enabled = std::getenv("SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION");
    if (!enabled || std::strcmp(enabled, "1") != 0) return;
    static std::atomic_bool recorded{false};
    if (recorded.load()) return;
    int gpu = 0, cpu = 0;
    const char * provider = nullptr;
    const char * description = nullptr;
    for (int i = 0; i < ggml_graph_n_nodes(graph); ++i) {
        ggml_tensor * node = ggml_graph_node(graph, i);
        if (node->op == GGML_OP_NONE || node->op == GGML_OP_RESHAPE || node->op == GGML_OP_VIEW
            || node->op == GGML_OP_PERMUTE || node->op == GGML_OP_TRANSPOSE
            || node->op == GGML_OP_CPY || node->op == GGML_OP_CONT || node->op == GGML_OP_DUP) continue;
        ggml_backend_t backend = ggml_backend_sched_get_tensor_backend(sched, node);
        ggml_backend_dev_t device = backend ? ggml_backend_get_device(backend) : nullptr;
        if (!device) continue;
        const auto type = ggml_backend_dev_type(device);
        const char * name = ggml_backend_reg_name(ggml_backend_dev_backend_reg(device));
        if ((type == GGML_BACKEND_DEVICE_TYPE_GPU || type == GGML_BACKEND_DEVICE_TYPE_IGPU)
            && (std::strcmp(name, "Vulkan") == 0 || std::strcmp(name, "Metal") == 0)) {
            ++gpu;
            provider = std::strcmp(name, "Vulkan") == 0 ? "vulkan" : "metal";
            description = ggml_backend_dev_description(device);
        } else if (type == GGML_BACKEND_DEVICE_TYPE_CPU) ++cpu;
    }
    if (!gpu || !description || recorded.exchange(true)) return;
    // Llama submits asynchronously; synchronize before claiming completed work.
    ggml_backend_sched_synchronize(sched);
    std::fprintf(stderr, "SOUNDSCAPER_GPU_COMPUTE_V1 provider=%s gpu=%d cpu=%d device=", provider, gpu, cpu);
    for (size_t i = 0; description[i] && i < 256; ++i)
        std::fprintf(stderr, "%02x", static_cast<unsigned char>(description[i]));
    std::fputc('\\n', stderr);
    std::fflush(stderr);
}
`;
const SOURCE_HASHES = {
	'whisper-cpp': 'dc70e14a08119b58ed2a7c7c2919f87b120897f75648002202cce58d8e09191f',
	'llama-cpp': '76a70d9da8e55ef9047ace696be837548872632101a017a7fad03542fc81e7a7',
};

export function patchAssistanceGgmlGpuReceipt(source, familyId) {
	// Whisper also has a CPU-only overload; identify the scheduler signature exactly.
	const declaration = familyId === 'whisper-cpp' ? `static bool ggml_graph_compute_helper(
      ggml_backend_sched_t   sched,
        struct ggml_cgraph * graph,
                       int   n_threads,
                      bool   sched_reset = true)`
		: familyId === 'llama-cpp' ? 'ggml_status llama_context::graph_compute(' : null;
	const before = familyId === 'whisper-cpp'
		? '    const bool t = (ggml_backend_sched_graph_compute(sched, graph) == GGML_STATUS_SUCCESS);'
		: '    auto status = ggml_backend_sched_graph_compute_async(sched.get(), gf);';
	const after = familyId === 'whisper-cpp'
		? `${before}\n    if (t) scape_gpu_compute_receipt(sched, graph);`
		: `${before}\n    if (status == GGML_STATUS_SUCCESS) scape_gpu_compute_receipt(sched.get(), gf);`;
	if (!declaration || source.split(declaration).length !== 2 || source.split(before).length !== 2
		|| source.includes('scape_gpu_compute_receipt')) throw new Error('The pinned GPU compute receipt source changed.');
	return source.replace(declaration, `${RECEIPT_SOURCE}\n${declaration}`).replace(before, after);
}

/** Source hashes and patch receipts remain inside each generated engine provenance. */
export async function patchDesktopAssistanceGgmlGpuReceipt(sourceRoot, familyId) {
	const file = familyId === 'whisper-cpp' ? 'src/whisper.cpp' : 'src/llama-context.cpp';
	const path = join(sourceRoot, file);
	const original = await readFile(path, 'utf8');
	if (hash(original) !== SOURCE_HASHES[familyId]) throw new Error('The GPU compute receipt source failed its pinned digest.');
	const patched = patchAssistanceGgmlGpuReceipt(original, familyId);
	await writeFile(path, patched);
	return { id: 'completed-gpu-graph-receipt-v1', file,
		inputSha256: hash(original), outputSha256: hash(patched), patchSha256: hash(RECEIPT_SOURCE) };
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
