The files in this directory retain the exact runner and acceleration source bytes
used by the 2026-10-22 production CPU measurement. Their original digests remain in
`production-cpu-report.json`. The current runtime
accepts structured GPU provider options; the retained measurement remains evidence
for the historical CPU run and does not certify the changed GPU runtime.

The historical conversion and CPU reports retain the earlier graph identities.
Their measured digests and results are unchanged; the conversion-report path
points to its retained copy here. The original converter and processor sources
are also available at repository commit `27260f13edca05231dff076465a8234ac25dac50`.
Current evidence describes the canonical graphs with debug metadata removed.

`corridorkey-conversion-pyproject.toml.txt` and
`corridorkey-conversion-uv.lock.txt` preserve the conversion dependencies used by
that measurement. The maintained conversion tool has since received Pillow and
Transformers security updates. The conversion report's `toolchainSnapshot` and
the production report's `provenance.toolchainLock` point to these original bytes;
their dependency digests and measured graph results remain unchanged. These text
snapshots are historical evidence, not installable dependency manifests.

The retained parity results do not certify the updated conversion dependencies.
Run the maintained conversion tool again before running a new production CPU
diagnostic: the diagnostic still requires the current toolchain to match the
conversion report and rejects a historical report with different dependencies.

`desktop-assistance-onnx-visual-tensors.ts.txt` preserves the tensor processor
used by both retained production CPU measurements. Its bytes were recovered
from the parent of `68af5c8bd` and verified against both reports' original byte
length and SHA-256. Both reports point to this snapshot after the production
bilinear resize optimization; their measured digests and results are unchanged.
These measurements do not certify the optimized tensor processor.

The retained tensor is Git blob `ec2bc588814e1b0144d2e7d4ace6956a95568b62`,
introduced at `desktop/assistance-onnx-visual-tensors.ts` by commit
`7a8440969a1e7c5cb89977def407ec922d515100`. Both reports authenticate these
6,772 bytes with SHA-256
`59fc55887fa9da58044b320b4fb87eb49ceb52d4fcc2140d3bce5959ea015f0a`.
`tests/framescaper-corridorkey-tensor-source-parity.test.ts` compares the current
direct tensor writer with this report-bound implementation across RGB/BGR
normalization, cropping, up/downsampling, edge clamping and invalid geometry.
Those deterministic comparisons support the source migration; they do not rerun
the recorded model or extend either historical CPU measurement to the current
runtime, GPU execution or publication readiness.

`linux-x64-runtime-snapshot.json.gz` and
`desktop-test-assistance-runtime-snapshots.json` preserve the runtime snapshot
and lock used by both measurements. They were recovered from the parent of
`50d5d179049cd7070fb237f7c9e11cded2d51d17` and checked against the reports'
original byte length, SHA-256, and source revision. Both reports point to the
retained snapshot; their measured digests and results are unchanged. Evidence
checks use the retained lock so refreshing desktop test runtimes does not
rebind historical measurements to unmeasured runtime bytes. The retained lock
also records the other targets; only the measured Linux x64 snapshot is copied
here. These measurements do not certify the refreshed desktop test runtimes.
