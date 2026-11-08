# Direct After Effects format research

Source reviews through 2026-11-08 of Storytold's Adobe interoperability projects
and related format candidates. This is a source review, not an adopted dependency,
executed parser qualification or installed-After-Effects result. Direct
`.aep`/`.aepx` parsing remains separate feasibility work outside the first
release's implemented M11 bridge. No installed AE environment is available.

## 2026-10-11: Storytold review

[EffectCraft's main README](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/README.md)
explicitly excludes opening AEP/AEPX. Its
[G4 gap register](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/docs/gaps.md)
identifies py-aep as a possible external converter requiring a maintainer scope
decision. The Rust application saves its own JSON project format. The license is
[MIT OR Apache-2.0](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/Cargo.toml);
its [NOTICE](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/NOTICE)
separates trademark and third-party asset terms.

[PR 251](https://github.com/storytold/effectcraft/pull/251) is open and unmerged.
The head inspected on 2026-10-11 was
`ee1afa01225280e041c34c9d2e8ab563c13c44ca`. It introduces an in-memory Rust decoder in
[`crates/engine/src/aep.rs`](https://github.com/storytold/effectcraft/blob/ee1afa01225280e041c34c9d2e8ab563c13c44ca/crates/engine/src/aep.rs):

- Binary RIFX/RIFF structure, composition/layer reconstruction, static transform
  values, and footage/font/plugin references. Animated transforms retain layer
  defaults. Text content currently uses the layer name and default styling;
  solid colors are fixed gray. Name-based composition maps and null fallbacks
  remain in reconstruction.
- AEPX performs four simple numeric tag searches and constructs one empty
  composition. It does not reconstruct an arbitrary XML project.
- Chunk depth/node/item caps exist, but limits and truncated payloads can yield
  partial trees instead of a refusal. Motionscaper's admission rules would need
  an independent audit. Seven synthetic module tests include signature,
  transform, small project and prefix/garbage checks; none establishes AE pixels.
- There is no binary AEP/AEPX writer in this proposal.

Its [stage tracker](https://github.com/storytold/effectcraft/blob/ee1afa01225280e041c34c9d2e8ab563c13c44ca/docs/aep/README.md)
records an unresolved provenance/scope decision and precomposition identity
problems. The header cites community reverse
engineering and py-aep; the tracker does not establish independent clean-room
provenance. Importing EffectCraft's engine would also bring a much broader
crate/model dependency closure than a standalone format reader.

Storytold does have other Adobe-adjacent format work:
[FilmCraft's interchange crate](https://github.com/storytold/filmcraft/blob/4e2d0bc2d3646f9cf27ef7aa8b2095c6858c7efe/crates/interchange/src/lib.rs)
reads/writes six timeline interchange formats, while
[PhotoCraft's PSD crate](https://github.com/storytold/photocraft/blob/60339cf67543a25179e2a83067fd61b237ad5ad7/crates/psd/README.md)
provides PSD/PSB reading and writing. Neither supplies AEP support.

## Separate candidates reached through that research

### py-aep: a real binary reader and writer

Pinned main: `edcae7abf08dc31b75c878d84b2a4e952105d842`. The latest published release
observed was [v0.18.1](https://github.com/forticheprod/py-aep/releases/tag/v0.18.1)
(2026-10-07); this review does not assume that release contains every main-branch
capability. This is Fortiche's separate project, not Storytold code.

The [public API](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/src/py_aep/__init__.py)
parses AEP and creates new projects.
[`Project.save`](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/src/py_aep/models/project.py#L2082)
writes a fresh destination through
[`write_aep`](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/src/py_aep/binary/chunk.py#L773),
which serializes RIFX chunks and trailing XMP. Saving is explicitly experimental
and refuses an existing destination. This is native format serialization,
not JSX generation or a renderer.

The [manifest](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/pyproject.toml)
specifies Python 3.7+, attrs, PyYAML, fonttools and, on supported Python versions,
uharfbuzz. The [MIT license](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/LICENSE)
requires retaining its copyright/permission notice. A desktop subprocess would
need a separately bounded, pinned Python/dependency distribution; it cannot be
dropped into the browser TypeScript bundle as-is.

The [format research](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/docs/file_format.md)
describes reverse engineering from saved files and AE behavior, principally
CC 2018 through AE 2026, with inferred/unknown fields identified. AEPX is out of
scope. The [limitations](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/docs/limitations.md)
include version-layout changes that cannot be solved by relabeling a file.
The [README](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/readme.md)
excludes expression evaluation and rendering, limits runtime-synthesized data,
and restricts adding effects to definitions already present in an AEP.

There are meaningful
[save/reparse and byte-identity tests](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/tests/roundtrip/test_models_project.py#L744)
and [cross-version tests](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/tests/read_only/test_versions.py).
The latter skip when a sample is missing. The
[quality workflow](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/.github/workflows/quality.yml)
restores Git LFS samples. These are upstream tests inspected as source, not
checks run here or proof that Motion-authored exports open/render in AE.

### aep-reader: a narrower Rust/WASM reader candidate

Pinned external project: `yueli-fx/aep-reader` at
`16cfdb6983621370352a8dd26dcd01845378bb83`, linked from EffectCraft issue 190.
Its [manifest](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/Cargo.toml)
is an unpublished Rust crate, MIT OR Apache-2.0, with no default dependencies
and optional Serde. Its
[byte API](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/src/lib.rs)
and [limits](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/src/error.rs)
separate parsing from filesystem access and bound bytes, chunks, nesting,
keyframes and accounted allocations. Original chunk spans remain available.
This is a plausible browser-WASM/native investigation route, not a shipped
Motionscaper adapter or demonstrated browser runtime integration.

The [scope](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/README.md)
excludes writing, AEPX, rendering, media decoding and expression/plugin execution.
An experimental EffectCraft adapter writes `.ecproj` with an omissions report.
[Provenance](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/PROVENANCE.md)
explicitly traces private Go work and previous reference implementations and
makes no independent clean-room claim.

The [validation record](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/VALIDATION.md)
reports 2,197 binary projects converting and reopening among 2,734 local inputs;
the remainder were 536 Git LFS pointers and one invalid header. It also reports
synthetic boundary tests and actual EffectCraft samples. These results do not
establish AE reference fidelity, and the private source projects are not
distributed as a public reproducible benchmark. The stated Wasm check establishes compilation, not a
browser UI. No such tests were run during this research.

## 2026-10-25: newer Storytold reader/writer proposal

[EffectCraft PR 1869](https://github.com/storytold/effectcraft/pull/1869) was open
and unmerged when reviewed. Its inspected head is
`9c5db1bfe0cca7313c758b885e6ab329c6a0660f`. Current upstream main was
`a0ea5f5ab12d44ed16dd6b53318fc9e2c21d95bc`; the proposal was five commits ahead
and 318 behind it, and main contained no AEP crates. These observations do not
replace the pinned October 11 review above. [PR 251](https://github.com/storytold/effectcraft/pull/251)
and the external py-aep converter [PR 860](https://github.com/storytold/effectcraft/pull/860)
also remained open.

The proposed standalone [`effectcraft-aep` manifest](https://github.com/vangel76/effectcraft/blob/9c5db1bfe0cca7313c758b885e6ab329c6a0660f/crates/aep/Cargo.toml)
has no dependencies and inherits [MIT OR Apache-2.0](https://github.com/vangel76/effectcraft/blob/9c5db1bfe0cca7313c758b885e6ab329c6a0660f/Cargo.toml).
Its [byte API](https://github.com/vangel76/effectcraft/blob/9c5db1bfe0cca7313c758b885e6ab329c6a0660f/crates/aep/src/lib.rs)
reads binary AEP and XML AEPX into a chunk tree and writes binary AEP; no AEPX
writer was found. A typed view exposes decoded project fields. The
[parser limits](https://github.com/vangel76/effectcraft/blob/9c5db1bfe0cca7313c758b885e6ab329c6a0660f/crates/aep/src/read.rs)
bound nesting and chunk count, retaining over-depth content as opaque bytes.
Those limits alone do not qualify Motionscaper admission. The separate
[project exporter](https://github.com/vangel76/effectcraft/blob/9c5db1bfe0cca7313c758b885e6ab329c6a0660f/docs/aep-export.md)
edits embedded AE-generated templates, including undecoded chunks; its importer
and exporter target EffectCraft's project model.

The contributor reports 513 passing tests and two ignored corpus tests on Linux
on October 24, plus manual AE 2026 round trips on Windows. Those are upstream
author reports: no crate, converter, browser integration or installed-AE
qualification was executed here. The proposal is another native-format
candidate, not an adopted dependency or evidence of Motionscaper compatibility.
The M11 bridge boundary and its installed-host completion gate remain unchanged.

## Current implementation comparison

EffectCraft's importer [PR 2558](https://github.com/storytold/effectcraft/pull/2558)
merged on November 4 and is included, alongside export, in
[v0.22.0](https://github.com/storytold/effectcraft/releases/tag/v0.22.0).
The source comparison below pins main at
`a41ff5015c6687db15a6f074a47b870b8f09fece`. The earlier unmerged-proposal reviews
above describe their historical snapshots.

The current [`effectcraft-aep` crate](https://github.com/storytold/effectcraft/blob/a41ff5015c6687db15a6f074a47b870b8f09fece/crates/aep/Cargo.toml)
includes the container reader, an adapter to EffectCraft's project model, and a
writer that builds its chunks in code. It now depends on EffectCraft's time,
color, keyframe, project and effects crates, Serde and thiserror. Adopting it
would require an independently reviewed dependency closure and a Motion adapter;
it is not a standalone zero-dependency parser that can replace the bridge.

| Concern | EffectCraft | Motionscaper bridge contract |
| --- | --- | --- |
| Native format | Reads binary AEP and XML AEPX; writes binary AEP. | Uses installed-AE scripts and inert exchange JSON. Selecting AEP/AEPX opens bridge instructions. Native parsing remains separate work. |
| Timing | [Frame mapping](https://github.com/storytold/effectcraft/blob/a41ff5015c6687db15a6f074a47b870b8f09fece/crates/aep/src/import/time.rs) retains exact rational NTSC rates and frame-aligned times. | Recovers exact 24000, 30000, 48000, 60000 and 120000 / 1001 rates from host floating clocks. Other rates use the reported bounded clock. Duration counts use the source rate before quantization, avoiding an added frame. |
| Extreme stretch | [PR 3256](https://github.com/storytold/effectcraft/pull/3256) clamps out-of-range stretch and reports the correction. | Refuses magnitudes below 1 or above 9900 percent before source-time division, matching installed-import preflight. Valid negative stretch retains its sign; source data is not silently corrected. |
| Separated Position | [Parity proposal 2760](https://github.com/storytold/effectcraft/pull/2760), still unmerged at this review, replaces inactive combined Position with the active axis channels. | Captures the leader's explicit separation state. Complete scalar axes become independent hold/linear or reviewed sampled curves. Missing state, duplicate/incomplete axes, unsupported easing or expressions are reported; stale combined coordinates are not substituted. Motion-authored reverse export uses combined Position; direct installed import of separated exchange data requires a separate host mapping. |
| Text breaks | [Text mapping](https://github.com/storytold/effectcraft/blob/a41ff5015c6687db15a6f074a47b870b8f09fece/crates/aep/src/import/text.rs) treats U+0003 as a line break. | Retains U+0003 exactly in Source Text custody and converts it, CR and CRLF to Motion line feeds under reviewed text reflow. Names, fonts and other strings retain their existing control-character restrictions. |
| Disabled shapes and image sequences | Reads shape visibility and sequence references. | Captured vector enable switches already control paint. Uncollected source image sequences are explicitly refused rather than represented by their first frame. |
| Text, effects and renderer fidelity | Broader text, effect and layer-style mappings; unsupported data is reported. | Retains the reviewed text/font, shape, Gaussian and limited scene subsets and complete rendered fallback. No arbitrary effect, font substitution, expression execution or renderer compatibility follows from agreement with another importer. |

These are independent TypeScript bridge changes informed by the source comparison;
no EffectCraft code, crate or fixture is vendored. Upstream's reported AE renders
do not qualify Motionscaper's installed-host matrix. Source custody, media
verification, explicit import review and the installed-AE completion gate remain
the [bridge's requirements](motionscaper-after-effects-bridge.md).

## Native-format follow-on

Keep the existing script/exchange/rendered-transfer workflow and its explicit
installed-host qualification gate. Do not add these dependencies to the release
branch on the basis of repository claims.

A separate feasibility spike should compare the pinned standalone Rust reader,
the current EffectCraft container crate and py-aep on our own versioned fixtures, retaining
their source and provenance records. Start with read-only extraction into
Motionscaper's inert exchange/report model. Require hard limits, cancellation,
exact original-AEP custody, explicit unsupported entries, and user-selected
media access; never execute expressions/plugins or follow arbitrary source paths.
Test duplicate names, parent/precomp references, fractional timing, malformed
inputs, unknown chunks and save/reopen custody. Use upstream agreement only as a
diagnostic, not the correctness oracle.

Treat direct binary writing as a separate experiment comparing py-aep and
EffectCraft's code-built writer, with new destinations and pinned target versions.
Its acceptance still requires real installed-AE reopen/render evidence,
unavailable here. None of these candidates eliminates that gate or provides
native AE plug-in compatibility. The native-format review adopts no parser,
vendored source, runtime asset or dependency.
