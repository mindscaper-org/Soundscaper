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
