# Motionscaper native After Effects import

**File > Import After Effects Project** and **File > Open** read `.aep` and
`.aepx` directly. The TypeScript importer runs in browser and desktop renderers;
it requires no Adobe installation, JSX exporter, exchange JSON, bridge script,
Rust runtime or external converter. Native AEP writing is not implemented.

## Admission and source preservation

`aep-container.ts` reads bounded big-endian RIFX/Egg! chunks. `aepx-container.ts`
uses saxes to construct the same inert chunk representation from Adobe XML.
DTD declarations, external entities, malformed lengths, invalid hex, duplicate
identities and unresolved/cyclic project references are refused. Text documents
use a bounded data-only dictionary parser; no PostScript operators, expressions
or plug-ins execute. Unknown container data remains in the original attachment.

Projects are limited to 64 MiB, 250,000 container chunks, depth 48, 8,192 items,
4,096 layers per project and 262,144 numeric keys. Individual numeric
properties admit at most 4,096 keys. Media selection admits 64 MiB per file,
fonts 16 MiB per face, and the original project plus selected sources 256 MiB.
Media and fonts are decoded through the existing bounded application readers.
Source paths are labels only; the importer never opens them or fetches a URL.
Users select original media and font files explicitly.

`controller/import/native-aep-import.ts` prepares an immutable review without
writing the project store. Acknowledgement publishes a new project through one
private asset transaction. Exact attachment/media hashes are checked before
publication. Failed publication rolls back; failed rollback retains the exact
cleanup capability for retry and the dialog blocks another transfer or closure.
The source `.aep` is never a Save destination. Desktop reads retain existing
release/acknowledgement retry fences and defer queued opens through lazy review.

The original file is a hashed `attachment` asset in the ordinary project closure.
`nativeImport` identifies it and retains the bounded conversion report. Save,
Save Copy and `.mscape` round trips preserve the original bytes and selected
media/fonts. Download Original Project and Download Import Report are available
in review. These operations do not modify the original project or media.

## Editable subset and explicit limits

- Compositions use item IDs independently of display names. Frame counts and
  NTSC rational clocks, work areas, precompositions, parent links, visibility,
  solo state and signed time stretch have native mappings.
- Solids, explicitly selected image/footage sources and nulls import directly.
  Missing media and uncollected image sequences become reported placeholders.
  Supplied audio remains retained but muted; AE audio interpretation is pending.
- Position, separated Position axes, anchor, scale, rotation, opacity and numeric
  time remapping retain authored values and supported hold/linear/temporal ease.
  Spatial tangents, roving keys and expressions are reported. Expressions remain
  inert. Crossing temporal control times use exact cubic subdivision to retain
  Motion's interpolation guard without changing the curve.
- Static rectangle, ellipse, polystar and Bezier geometry becomes editable paths.
  Duplicate occurrences and group visibility are preserved. Static group
  transforms flatten into geometry; stroke scaling, group compositing, advanced
  paints/operators and animated geometry require review and are reported.
- Static native mask paths, inversion, supported operations, authored numeric
  mask channels and resolvable alpha/luma track mattes have mappings. Animated
  mask paths and Lighten/Darken mask operations are reported.
- Source Text characters, basic style runs, fill color, size and tracking map
  only to explicitly selected font faces. CR and U+0003 become line feeds.
  Paragraph boxes retain their local origin; point text uses a reported
  composition-sized reflow box. Baselines, wrapping, advanced styles, vertical
  text, animation and AE typography are not rendering equivalents.

Unsupported groups, effects, cameras/lights, layer styles, collapse behavior,
non-square pixels, color management and shutter sampling remain reported in
source custody. Motion's linear SDR renderer does not establish AE pixel
fidelity. Review the report and imported draft before production use.

## Format evidence and compatibility

The independent reader uses published format facts from EffectCraft revision
`a41ff5015c6687db15a6f074a47b870b8f09fece`; see the
[pinned comparison](motionscaper-aep-native-format-research.md). No EffectCraft
implementation code or crate is adopted. The unmodified binary/XML test pair in
`tests/fixtures/native-aep/` comes from EffectCraft Corpus revision
`97262276f625afdeeb61787e4cbb74b3f17af510`, with digest assertions, MIT notices
and contributor attribution beside it. It was authored in AE 2026 and sanitized
upstream; embedded color profile stubs are not color-transform evidence.
Synthetic malformed/bounds fixtures supplement that pair. These tests establish
format and storage behavior, not complete AE-version or renderer qualification.

Legacy exchange/custody modules remain readable for previously saved projects
and retain their focused conversion tests. The bridge dialog and script controls
are removed from the product. Existing host-script development sources are
compatibility tooling, not part of the native importer or a product workflow.
