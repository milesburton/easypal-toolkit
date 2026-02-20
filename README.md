# DRM Studio

Web-based EasyPal (Digital SSTV) encoder/decoder. Encode images to DRM audio and decode DRM transmissions — entirely in the browser, no server required.

**Live App:** https://milesburton.github.io/easypal-toolkit/

## Features

- Encode images to Digital SSTV/EasyPal audio (WAV)
- Decode Digital SSTV/EasyPal audio to images (PNG)
- DRM Mode B · OFDM · 16-QAM · Convolutional FEC
- Client-side only — no server required

## Usage

### Encode
1. Upload a source image (JPEG, PNG, etc.)
2. The encoder produces a DRM Mode B WAV file
3. Download the WAV

### Decode
1. Upload a DRM-encoded WAV file
2. The decoder demodulates and reconstructs the image
3. Download the decoded PNG

## Technical Details

Digital SSTV (EasyPal / HAMDRM) uses:
- **DRM (Digital Radio Mondiale)** — OFDM with QAM subcarriers
- **Convolutional coding** with Viterbi decoding
- **JPEG compression** for image payloads
- **Interleaving** for burst-error resilience

## Contributing

Contributions welcome.

## License

MIT
