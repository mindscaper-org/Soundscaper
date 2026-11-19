
---
license: apache-2.0
pipeline_tag: audio-to-audio
tags:
  - speech_enhancement
  - noise_suppression
  - real_time
  - streaming
  - causal
  - onnx
  - tflite
  - fullband
---

# DPDFNet

DPDFNet is a family of **causal, single‑channel** speech enhancement models for **real‑time noise suppression**.\
It builds on **DeepFilterNet2** by adding **Dual‑Path RNN (DPRNN)** blocks in the encoder for stronger long‑range modeling while staying streaming‑friendly.

**Links**
- Project page (audio samples + architecture): https://ceva-ip.github.io/DPDFNet/
- Paper (arXiv): https://arxiv.org/abs/2512.16420
- Code (GitHub): https://github.com/ceva-ip/DPDFNet
- Demo Space: https://huggingface.co/spaces/Ceva-IP/DPDFNetDemo
- Evaluation set: https://huggingface.co/datasets/Ceva-IP/DPDFNet_EvalSet

---

## What’s in this repo

- **TFLite**: `*.tflite` (root)
- **ONNX**: `onnx/*.onnx`
- **PyTorch checkpoints**: `checkpoints/*.pth`

---

## Model variants

### 8 kHz narrowband model

| Model | DPRNN blocks | Params (M) | MACs (G) |
|---|:---:|:---:|:---:|
| `dpdfnet2_8khz` | 2 | 2.51 | 1.29 |
| `dpdfnet8_8khz` | 8 | 3.56 | 3.99 |

### 16 kHz wideband models

| Model | DPRNN blocks | Params (M) | MACs (G) |
|---|:---:|:---:|:---:|
| `baseline` | 0 | 2.31 | 0.36 |
| `dpdfnet2` | 2 | 2.49 | 1.35 |
| `dpdfnet4` | 4 | 2.84 | 2.36 |
| `dpdfnet8` | 8 | 3.54 | 4.37 |

### 48 kHz fullband model

| Model | DPRNN blocks | Params (M) | MACs (G) |
|---|:---:|:---:|:---:|
| `dpdfnet2_48khz_hr` | 2 | 2.58 | 2.42 |
| `dpdfnet8_48khz_hr` | 8 | 3.63 | 7.17 |

---

## Recommended inference (CPU-only, ONNX)

```bash
pip install dpdfnet
```

### CLI

```bash
# Enhance one file
dpdfnet enhance noisy.wav enhanced.wav --model dpdfnet4

# Enhance a directory (uses all CPU cores by default)
dpdfnet enhance-dir ./noisy_wavs ./enhanced_wavs --model dpdfnet2

# Enhance a directory with a fixed worker count
dpdfnet enhance-dir ./noisy_wavs ./enhanced_wavs --model dpdfnet2 --workers 4

# Download models
dpdfnet download
dpdfnet download dpdfnet8
dpdfnet download dpdfnet4 --force
```

### Python API

```python
import soundfile as sf
import dpdfnet

# In-memory enhancement:
audio, sr = sf.read("noisy.wav")
enhanced = dpdfnet.enhance(audio, sample_rate=sr, model="dpdfnet4")
sf.write("enhanced.wav", enhanced, sr)

# Enhance one file:
out_path = dpdfnet.enhance_file("noisy.wav", model="dpdfnet2")
print(out_path)

# Model listing:
for row in dpdfnet.available_models():
    print(row["name"], row["ready"], row["cached"])

# Download models:
dpdfnet.download()				# All models
dpdfnet.download("dpdfnet4")	# Specific model
```

### Real-time Microphone Enhancement

Install `sounddevice` (not included in `dpdfnet` dependencies):

```bash
pip install sounddevice
```

`StreamEnhancer` processes audio chunk-by-chunk, preserving RNN state across
calls.  Any chunk size works; enhanced samples are returned as soon as enough
data has accumulated for the first model frame (20 ms).

```python
import numpy as np
import sounddevice as sd
import dpdfnet

INPUT_SR   = 48000
# Use one model hop (10 ms) as the block size so process() returns
# exactly one hop's worth of enhanced audio on every callback.
BLOCK_SIZE = int(INPUT_SR * 0.010)   # 480 samples at 48 kHz

enhancer = dpdfnet.StreamEnhancer(model="dpdfnet2_48khz_hr")

def callback(indata, outdata, frames, time, status):
    mono_in = indata[:, 0] if indata.ndim > 1 else indata.ravel()
    enhanced = enhancer.process(mono_in, sample_rate=INPUT_SR)
    n = min(len(enhanced), frames)
    outdata[:n, 0] = enhanced[:n]
    if n < frames:
        outdata[n:] = 0.0   # silence while the first window accumulates

with sd.Stream(
    samplerate=INPUT_SR,
    blocksize=BLOCK_SIZE,
    channels=1,
    dtype="float32",
    callback=callback,
):
    print("Enhancing microphone input - press Ctrl+C to stop")
    try:
        while True:
            sd.sleep(100)
    except KeyboardInterrupt:
        pass

# Optional: drain the final partial window at the end of a recording
tail = enhancer.flush()
```

> [!NOTE]
> **Latency**  
> The first enhanced output arrives after one full model window (~20 ms) has been buffered. All subsequent blocks are returned with ~10 ms additional delay.
>
> **Sample rate**  
> `StreamEnhancer` resamples internally. Pass your device's native rate as `sample_rate`; the return value is at the same rate.
>
> **Block size**  
> Using `BLOCK_SIZE = int(SR * 0.010)` (one model hop) gives one enhanced block per callback. Other sizes also work but may produce empty returns while the buffer fills.
>
> **Multiple streams**  
> Create a separate `StreamEnhancer` per stream. Call `enhancer.reset()` between independent audio segments to clear RNN state.

---

## Citation

```bibtex
@article{rika2025dpdfnet,
  title  = {DPDFNet: Boosting DeepFilterNet2 via Dual-Path RNN},
  author = {Rika, Daniel and Sapir, Nino and Gus, Ido},
  year   = {2025}
}
```

---

## License

Apache-2.0
