# Current Develop combined RAW qualification

The focused browser corpus composes the real pinned LibRaw workers with saved
Current4 recipes, authenticated LUT and brush resources, Original Clone, color,
optics, local masks, spatial effects and final geometry. A separate whole-recipe
CPU execution supplies the independent expected pixels; it never supplies GPU
input. Counterexamples verify that removing repair or masks, or reordering tone
and LUT, changes the output.

The observer calls the original WebGL methods and records actual uploads,
draws, readbacks and handle retirement. It retains at most one 128×128 RGBA
Float32 readback, wipes it on close, and exposes only bounded scalar comparisons.
The comparison independently enforces exact alpha, zero and tiny samples and
the maintained eight-ULP limit for ordinary RGB samples.

On 2026-10-18, all nine cases passed with Chromium 151.0.7922.34 and the pinned
SwiftShader configuration. A RAW/Clone/color/LUT/mask/geometry control delivered
actual GPU pixels with a maximum two-ULP RGB difference. The complete nonlinear
canonical, headroom and recovery recipes produced native candidate readbacks
outside the precision contract. The production guard refused those candidates,
retired their GL resources, and delivered exactly one whole-recipe CPU result
whose every Float32 word matched the oracle. These are precision fallbacks,
not successful GPU deliveries. No production tolerance or numeric guard changed.

The remaining cases cover the known repair underflow boundary, corrupt LUT and
brush refusal, held resource cancellation, and a held consumer whose delivered
output remains live until release and then retires. Each active deadline cancels
work, releases owned gates and joins the work before teardown.

This finite component corpus does not certify all recipes, physical GPUs,
Firefox, native desktop decoder services or complete application workflows.
The focused run used one browser worker, peaked at 674,156,544 bytes in its
enforced cgroup, and recorded no cgroup OOM events. Verification builds were
removed after process and open-file checks. No **Update AI assets** run is
required: only browser qualification and documentation changed.
