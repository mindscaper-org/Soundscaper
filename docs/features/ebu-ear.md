# EBU EAR speaker rendering

Open **File > Export audio**, then choose an output layout under
**Rendering > EBU EAR speaker rendering**. The control appears for an authored
ADM programme and defaults to off. Author the programme through the existing
Metadata editor's ADM tab, including its bed assignments and positioned objects.

Supported outputs are stereo, 5.1, 5.1.2, 5.1.4, 7.1 and 7.1.4. The output uses
the channel order in `adm-bed-layout.ts`. Choose a container and codec capable
of carrying that width. The renderer operates before loudness normalization,
dither and encoding, so the ordinary delivery checks apply to the rendered PCM.
The existing loudness meter supports at most eight delivered channels.

This is an offline export choice. It does not alter project playback, monitoring
or saved ADM authoring metadata. It is mutually exclusive with the existing
headphone renderer. Split outputs and BW64/ADM passthrough cannot use it. An
export that exceeds offline admission refuses instead of falling back to a
stream that cannot execute EAR. The worker's cloned inputs, outputs and fixed
32 MiB WebAssembly memory count toward export admission.

The adapter uses the unmodified EBU libear gain calculators for the application's
static polar point objects and DirectSpeakers beds. It preserves the programme's
terminal strip routing while capturing the source channels, then applies the
calculated gains in an export-owned worker. Matching speaker labels are reordered
explicitly into the declared output order. Object and assignment gains are
already applied by the source render and are not applied a second time.

The delivery report records libear's version, revision, output layout, source
and output widths, limitations and a bundled notice asset. Rendering produces
ordinary speaker PCM; it does not attach ADM metadata describing the original
bed and objects to those new channels. The unrendered BW64 export remains the
interchange route.

The adapter does not implement arbitrary imported ADM timelines, moving or
diffuse objects, object extent, HOA, BEAR binaural HRTFs, room correction or
bass management. In particular, EAR omits LFE input when the target has no LFE
speaker. The output is not a Dolby Atmos bitstream or a certified Dolby render.

See the [source and licensing notice](../../src/common/editor/ear/NOTICE.md) for
exact upstream revisions, source archives, licenses, reproduction and audit
commands. The WebAssembly bytes are authenticated before instantiation and
remain isolated from the user's files and devices. A render worker is terminated
on completion, cancellation or failure; partial output is never published.
