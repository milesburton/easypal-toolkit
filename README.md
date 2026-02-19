# EasyPal Toolkit

⚠️ **WORK IN PROGRESS** - Digital SSTV decoder implementation underway

Web-based EasyPal (Digital SSTV) encoder/decoder. This project aims to provide browser-based tools for encoding images to Digital SSTV audio and decoding Digital SSTV transmissions.

**Live App:** https://milesburton.github.io/easypal-toolkit/ _(currently non-functional)_

## Current Status

🚧 **In Development** - Digital SSTV protocol implementation in progress

### Planned Features

- [ ] Decode Digital SSTV/EasyPal audio to images (PNG)
- [ ] Encode images to Digital SSTV/EasyPal audio (WAV)
- [ ] PSK modulation support
- [ ] Reed-Solomon error correction
- [ ] JPEG compression
- [ ] Client-side only — no server required

## Planned Usage

### Decode (In Development)
1. Upload Digital SSTV/EasyPal audio file (WAV/MP3/OGG)
2. Automatic protocol detection and decoding
3. Download decoded image (PNG)

### Encode (Planned)
1. Upload source image
2. Configure transmission parameters
3. Download Digital SSTV audio file (WAV)

## Technical Details

Digital SSTV (also known as EasyPal or HAMDRM) uses:
- **PSK31-like digital modulation** (not FM like analog SSTV)
- **JPEG compression** for efficient image encoding
- **Reed-Solomon error correction** for reliability
- **OFDM** for robust transmission

## Contributing

This is an actively developing project. Contributions welcome!

## License

TBD - Considering GPL v3 due to potential use of QSSTV reference implementation
