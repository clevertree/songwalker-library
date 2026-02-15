# SongWalker Library

Preset library for the [SongWalker](https://github.com/clevertree/songwalker) music language engine.

Hosted via GitHub Pages at:  
**https://clevertree.github.io/songwalker-library/**

## Structure

```
index.json                          # Root index (lists all libraries)
_shared/                            # Built-in oscillator synths & effects
  index.json
  synths/Sine/preset.json
  synths/Square/preset.json
  ...
FluidR3_GM/                         # Source library (from SF2 soundfont)
  index.json
  instruments/piano/Acoustic_Grand_Piano/preset.json
  instruments/piano/Bright_Acoustic_Piano/preset.json
  percussion/Percussion_C3_60/preset.json
  ...
Aspirin/
  ...
```

Each library directory contains:
- `index.json` — library index listing all presets
- Categorized preset directories with `preset.json` files

## Preset Format

```json
{
  "format": "songwalker-preset",
  "version": 1,
  "name": "Acoustic Grand Piano",
  "tags": ["piano", "acoustic", "keyboard"],
  "metadata": {
    "source": "FluidR3_GM",
    "gmProgram": 0,
    "category": "piano",
    "originalFile": "0000_FluidR3_GM_sf2_file.js"
  },
  "node": {
    "type": "sampler",
    "zones": [
      {
        "keyRangeLow": 21,
        "keyRangeHigh": 108,
        "sampleRate": 44100,
        "loopStart": 10000,
        "loopEnd": 20000,
        "coarseTune": 0,
        "fineTune": 0,
        "originalPitch": 6000,
        "sampleData": "base64-encoded PCM..."
      }
    ]
  }
}
```

## Libraries

| Library | Presets | Description |
|---------|---------|-------------|
| _shared | 7 | Built-in oscillator synths and effects (no samples) |
| Aspirin | 128 | Aspirin soundfont |
| Chaos | 175 | Chaos soundfont |
| FluidR3_GM | 175 | FluidR3 GM soundfont |
| GeneralUserGS | 128 | GeneralUserGS soundfont |
| JCLive | 175 | JCLive soundfont |
| SBLive | 175 | SBLive soundfont |
| SoundBlasterOld | 128 | SoundBlasterOld soundfont |
| Acoustic_Guitar | 1 | Acoustic Guitar soundfont |
| Gibson_Les_Paul | 1 | Gibson Les Paul soundfont |
| LesPaul | 4 | LesPaul soundfont |
| SBAWE32 | 5 | SBAWE32 soundfont |
| Soul_Ahhs | 2 | Soul Ahhs soundfont |
| Stratocaster | 2 | Stratocaster soundfont |
| LK_AcousticSteel_SF2_file | 1 | LK AcousticSteel soundfont |
| LK_Godin_Nylon_SF2_file | 1 | LK Godin Nylon soundfont |

**Total: 1,108 presets across 16 libraries**

## Regenerating

From the `songwalker` project:

```bash
# Convert webaudiofontdata sources to preset format
node scripts/convert-webaudiofontdata.mjs \
  --source ../samples/webaudiofontdata/public \
  --output ../songwalker-library

# Generate index files
node scripts/generate-index.js ../songwalker-library
```

## License

Soundfont samples are derived from various SF2 soundfonts. See individual source soundfont licenses for details.

Built-in presets (`_shared/`) use Web Audio API oscillators and are not subject to sample licensing.
