This directory retains the tensor source used by the historical production CPU
measurement in `../framescaper-corridorkey-production-cpu-candidate.json`, measured
on 2026-10-26. That report and its measured pins remain unchanged. It is evidence
for the recorded source and runtime, not a new measurement of current source,
GPU execution, or publication readiness.

`desktop-assistance-onnx-visual-tensors.ts.txt` is the exact Git blob
`ec2bc588814e1b0144d2e7d4ace6956a95568b62`, introduced by commit
`7a8440969a1e7c5cb89977def407ec922d515100` at
`desktop/assistance-onnx-visual-tensors.ts`. Its 6,772 bytes have SHA-256
`59fc55887fa9da58044b320b4fb87eb49ceb52d4fcc2140d3bce5959ea015f0a`, matching
the original processor-source pin in the report. The evidence test resolves only
that original path to this retained copy and authenticates its original pin.
Every other processor, runner, conversion, register, lock and runtime pin still
matches its recorded path.

Main commit `c02b9d73b` replaced temporary bilinear RGB arrays with direct CHW
tensor writes, preserving channel selection, interpolation arithmetic and final
float rounding. The maintained implementation keeps that optimization.
`tests/framescaper-corridorkey-tensor-source-parity.test.ts` compares its tensor
bytes with this authenticated implementation across RGB/BGR normalization,
cropping, up/downsampling, edge clamping and invalid geometry. Those deterministic
comparisons support the source migration; they do not rerun the recorded model
or extend the historical CPU measurement to the current runtime.
