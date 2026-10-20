# Interchange conformance reference implementations

This reference explains how the interchange profiles are checked against
readers that are not ours and what must be provisioned to do it. The
[delivery and interchange architecture](../architecture/delivery-and-interchange.md)
owns the product contracts.

## Why a third-party reader at all

The in-tree conformance suites prove each emitted file is self-consistent: the
EDL re-parses, the OTIO values are whole, the FCPXML times are rational. That is
worth having and it is not the same claim as "a real NLE can read this". A
writer and its own reader can share a misunderstanding indefinitely and every
test will stay green.

So the profiles are additionally read back by the OpenTimelineIO reference
implementation and its format adapters. Nothing in that assertion path is ours:
our exporter writes bytes, a Python reader parses them, and the test asserts on
what came back.

## What is provisioned

`config/interchange-conformance-tools.json` pins the exact versions;
`scripts/provision-interchange-conformance.mjs` fetches and verifies them into
`vendor/interchange-conformance/`, which is not committed.

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| `opentimelineio` | 0.18.1 | Apache-2.0 | 6C-1b round trip; plugin host for the adapters |
| `otio-cmx3600-adapter` | 1.0.0 | Apache-2.0 | reference CMX3600 reader |
| `otio-fcpx-xml-adapter` | 1.0.0 | Apache-2.0 | reference FCPXML reader |
| `xmlschema` | 3.4.5 | MIT | XSD validator for the DAWproject profile |
| `elementpath` | 4.8.0 | MIT | XPath engine `xmlschema` depends on |

Run `npm run provision:interchange-conformance` once, then
`npm run test:reference:interchange`.

These are **conformance-time tools**. Normal product bundles exclude them.
The diagnostic nightly-with-tests includes the readers, their notices, and a
relocatable Python so it can run the same assertions without installing Python
on the user's machine. `node scripts/provision-nightly-interchange.mjs` prepares
this tree before nightly staging. `config/nightly-interchange-python.json` pins
the Python Build Standalone archives and digests for every maintained desktop
test target; the full installation, upstream library notices, and `PYTHON.json`
are retained. Windows ARM64 uses x64 Python under Windows emulation because
OpenTimelineIO 0.18.1 has no Windows ARM64 wheel. Apache-2.0 and MIT are compatible
with the product's GPLv3-family licensing.

### DAWproject: the published schema rather than a reference reader

DAWproject's reference implementation is a Java library, and this project's
toolchain carries no JVM. What the reference repository publishes alongside it
is `Project.xsd` and `MetaData.xsd`, generated from the same Java model the
reference reader is built from — so the schema states exactly what that reader
accepts: element names, the order of children, attribute types, the
enumerations, and that every `IDREF` resolves to an `xs:ID`. The two files are
vendored under `tests/fixtures/dawproject/` with their MIT notice (from
`bitwig/dawproject` commit `2c45c639`), and
`tests/audio-editor-dawproject-reference-conformance.test.ts` validates our
output against them with `xmlschema`, a validator that is not ours. The test
fails with the provisioning command when the validator is absent; it never
skips.

### Why the wheels are provisioned rather than committed

The OTIO core is a native extension published as twenty platform wheels. A
single vendored binary would work on one machine and no other, so what is
committed instead is the thing that makes provisioning reproducible: exact
versions, and sha256 digests for every wheel whose bytes are
platform-independent. The platform wheel is selected by asking pip which tags
this interpreter accepts — a hand-rolled PEP 425 matcher is a subtle way to
install something that imports on the build host and nowhere else — and
verified against the digest PyPI publishes for that exact version. That pins the
version and proves the bytes arrived intact. It does not, and does not claim to,
establish trust in PyPI itself.

### Why Apple's FCPXML DTD is not vendored

It is not published under terms that permit redistribution. Validating against a
schema we may not carry would trade a licensing problem for a conformance claim
that the reference reader gives us honestly instead.

## Third-party notices

`THIRD_PARTY_LICENSES.md` records the pinned reference packages, their terms,
and the Python installation distributed with the diagnostic nightly. The FFmpeg
runtime manifest binds the notice bytes with ordinary byte-length and SHA-256
integrity metadata; `node scripts/repin-runtime-evidence.mjs` refreshes those
descriptors after a deliberate notice edit, with no human approval record.
