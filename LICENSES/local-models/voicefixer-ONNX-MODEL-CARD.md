---
license: mit
library_name: audiosronnx
pipeline_tag: audio-to-audio
tags: [speech-restoration, bandwidth-extension, declipping, dereverberation, onnx]
---

# audiosronnx-voicefixer

ONNX exports of [VoiceFixer](https://github.com/haoheliu/voicefixer) (Liu et al., MIT) for
the `voicefixer` engine in
[audiosronnx](https://github.com/TigreGotico/audiosronnx).

VoiceFixer is general speech **restoration** at 44.1 kHz. Where most engines target one
defect, this one is trained to undo noise, reverberation, clipping and bandwidth loss
together. Two stages, the same shape as the `sidon` engine: a ResUNet predicts a clean
log-mel and a TFGAN vocoder resynthesises the waveform.

```
analysis : mel_orig[1, 1, 501, 128]  ->  mel[1, 1, 501, 128]
vocoder  : mel[1, 1, 501, 128]       ->  wav[1, 1, ~221k]
```

| File | Purpose | Size |
|------|---------|------|
| `analysis.onnx` | ResUNet mel predictor | 282 MB |
| `vocoder.onnx` | TFGAN vocoder | 133 MB |
| `mel_filters.npy` | 1025x128 htk mel filterbank for the numpy front-end | 0.5 MB |

The STFT (n_fft 2048, hop 441), the mel projection and the `10**clip(x, max=5)` log inverse
all run in numpy inside audiosronnx.

Verified against torch **on real speech**: analysis correlation **1.00000000**, the pair
end-to-end **0.99999996** (71.4 dB SNR).

## Notes

- **Fixed window.** The analysis graph is length-specialised, so it takes a fixed 5 s
  (501-frame) window; audiosronnx slides it with a crossfade. Upstream's own
  `restore_inmem` segments long audio too.
- **`sp` is genuinely unused.** The module signature is `forward(sp, mel_orig)`, but zeroing
  or scaling `sp` changes the output by exactly zero, so the exported graph takes only
  `mel_orig`. That is correct, not a folded constant.
- **Measure parity on speech.** The same graph reads 6.8e-02 against random noise and
  2.3e-04 against speech. Noise is out of domain for a speech restoration model and drives
  it into a regime where float error through a 70M-parameter ResUNet amplifies.
- **Generative.** It resynthesises rather than filters, so restored detail is invented.

## License

MIT, inherited from the upstream VoiceFixer release.
