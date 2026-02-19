# EasyPal Toolkit

Web-based EasyPal (Digital SSTV) encoder/decoder. Converts images to EasyPal audio and decodes EasyPal transmissions in-browser.

**Live App:** https://milesburton.github.io/easypal-toolkit/

## Features

- Encode images to EasyPal audio (WAV)
- Decode EasyPal audio to images (PNG)
- Supports Robot 36, Martin M1, Scottie S1, PD120
- Automatic VIS code detection with timing-based fallback for non-standard headers (ISS)
- Frequency offset auto-calibration for Doppler-shifted signals
- Client-side only — no server required

## Usage

### Encode
1. Select EasyPal mode
2. Upload image
3. Download WAV file

### Decode
1. Upload EasyPal audio (WAV/MP3/OGG)
2. Mode auto-detected from VIS code
3. Download decoded PNG

## EasyPal Modes

| Mode | Resolution | Scan time | Colour |
|------|-----------|-----------|--------|
| Robot 36 | 320×240 | 36s | YUV |
| Martin M1 | 320×256 | 114s | RGB |
| Scottie S1 | 320×256 | 110s | RGB |
| PD120 | 640×496 | 122s | YUV |

## License

MIT
