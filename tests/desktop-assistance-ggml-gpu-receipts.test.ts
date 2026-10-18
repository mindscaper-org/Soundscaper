/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { patchAssistanceGgmlGpuReceipt } from '../scripts/lib/desktop-assistance-ggml-gpu-receipts.mjs';

const WHISPER = `static bool ggml_graph_compute_helper(
      ggml_backend_sched_t   sched,
        struct ggml_cgraph * graph,
                       int   n_threads,
                      bool   sched_reset = true) {
    const bool t = (ggml_backend_sched_graph_compute(sched, graph) == GGML_STATUS_SUCCESS);
    if (!t || sched_reset) {
        ggml_backend_sched_reset(sched);
    }
    return t;
}`;

test('Whisper receipts patch the scheduled overload before reset and preserve the CPU overload', () => {
	const cpuOverload = `static bool ggml_graph_compute_helper(
          struct ggml_cgraph * graph,
                         int   n_threads,
         ggml_abort_callback   abort_callback,
                        void * abort_callback_data) {
    return ggml_backend_graph_compute(backend.get(), graph) == GGML_STATUS_SUCCESS;
}`;
	const patched = patchAssistanceGgmlGpuReceipt(`${cpuOverload}\n\n${WHISPER}`, 'whisper-cpp');
	assert.ok(patched.startsWith(cpuOverload));
	assert.equal(patched.split('static void scape_gpu_compute_receipt(').length, 2);
	assert.match(patched, /if \(t\) scape_gpu_compute_receipt\(sched, graph\);\n {4}if \(!t \|\| sched_reset\)/u);
	assert.throws(() => patchAssistanceGgmlGpuReceipt(`${WHISPER}\n${WHISPER}`, 'whisper-cpp'));
});

test('GPU receipt patches reject changed anchors and attach only after successful graph submission', () => {
	const patched = patchAssistanceGgmlGpuReceipt(WHISPER, 'whisper-cpp');
	assert.match(patched, /if \(t\) scape_gpu_compute_receipt\(sched, graph\)/u);
	assert.throws(() => patchAssistanceGgmlGpuReceipt(patched, 'whisper-cpp'));
	assert.throws(() => patchAssistanceGgmlGpuReceipt(WHISPER.replace('const bool t', 'bool t'), 'whisper-cpp'));
	const llama = patchAssistanceGgmlGpuReceipt(`ggml_status llama_context::graph_compute() {
    auto status = ggml_backend_sched_graph_compute_async(sched.get(), gf);
}`, 'llama-cpp');
	assert.match(llama, /if \(status == GGML_STATUS_SUCCESS\) scape_gpu_compute_receipt/u);
});

test('native receipts require completed GPU compute and never report CPU-only or duplicate work', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-ggml-receipt-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const source = join(directory, 'receipt.cpp');
	const executable = join(directory, process.platform === 'win32' ? 'receipt.exe' : 'receipt');
	await writeFile(source, `
#include <cassert>
enum { GGML_OP_NONE, GGML_OP_RESHAPE, GGML_OP_VIEW, GGML_OP_PERMUTE, GGML_OP_TRANSPOSE, GGML_OP_CPY, GGML_OP_CONT, GGML_OP_DUP, MATMUL };
enum { GGML_BACKEND_DEVICE_TYPE_GPU, GGML_BACKEND_DEVICE_TYPE_IGPU, GGML_BACKEND_DEVICE_TYPE_CPU };
struct ggml_tensor { int op; int device; };
struct ggml_cgraph { ggml_tensor nodes[2] = {{MATMUL, 0}, {MATMUL, 1}}; };
using ggml_backend_sched_t = int;
using ggml_backend_t = const int *;
using ggml_backend_dev_t = const int *;
constexpr int GGML_STATUS_SUCCESS = 0;
static bool synchronized = false;
int ggml_graph_n_nodes(ggml_cgraph *) { return 2; }
ggml_tensor * ggml_graph_node(ggml_cgraph * g, int i) { return &g->nodes[i]; }
ggml_backend_t ggml_backend_sched_get_tensor_backend(int, ggml_tensor * t) { return &t->device; }
ggml_backend_dev_t ggml_backend_get_device(ggml_backend_t b) { return b; }
int ggml_backend_dev_type(ggml_backend_dev_t d) { return *d == 0 ? GGML_BACKEND_DEVICE_TYPE_GPU : GGML_BACKEND_DEVICE_TYPE_CPU; }
int ggml_backend_dev_backend_reg(ggml_backend_dev_t d) { return *d; }
const char * ggml_backend_reg_name(int d) { return d == 0 ? "Vulkan" : "CPU"; }
const char * ggml_backend_dev_description(ggml_backend_dev_t) { return "GPU"; }
void ggml_backend_sched_synchronize(int) { synchronized = true; }
void ggml_backend_sched_reset(int) {}
int ggml_backend_sched_graph_compute(int result, ggml_cgraph *) { return result; }
${patchAssistanceGgmlGpuReceipt(WHISPER, 'whisper-cpp')}
int main() {
  ggml_cgraph graph;
  graph.nodes[0].device = 1;
  ggml_graph_compute_helper(0, &graph, 1); // CPU success cannot produce a receipt.
  graph.nodes[0].device = 0;
  graph.nodes[0].op = GGML_OP_CPY;
  ggml_graph_compute_helper(0, &graph, 1); // Transfers cannot prove GPU model math.
  graph.nodes[0].op = MATMUL;
  ggml_graph_compute_helper(1, &graph, 1); // Failed GPU graph cannot produce a receipt.
  ggml_graph_compute_helper(0, &graph, 1);
  assert(synchronized);
  ggml_graph_compute_helper(0, &graph, 1); // At most one bounded receipt per process.
}
`);
	// This small self-authored ABI fixture runs no model, native runtime, or GPU.
	execFileSync(process.platform === 'win32' ? 'clang++' : 'c++', ['-std=c++17', source, '-o', executable]);
	const result = spawnSync(executable, { env: { ...process.env, SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION: '1' },
		stdio: ['ignore', 'pipe', 'pipe'] });
	assert.equal(result.status, 0, result.stderr.toString());
	assert.equal(result.stderr.toString(), 'SOUNDSCAPER_GPU_COMPUTE_V1 provider=vulkan gpu=1 cpu=1 device=475055\n');
});
