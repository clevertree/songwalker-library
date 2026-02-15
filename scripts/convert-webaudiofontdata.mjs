#!/usr/bin/env node
/**
 * convert-webaudiofontdata.mjs
 *
 * Converts webaudiofontdata JSON instrument files to the unified
 * songwalker-library preset format, organized by source library.
 *
 * Usage:
 *   node scripts/convert-webaudiofontdata.mjs \
 *     --source /path/to/webaudiofontdata/public \
 *     --output /path/to/songwalker-library
 *
 * The script:
 * 1. Reads instrumentNames.json + instrumentKeys.json for GM mapping
 * 2. Processes each JSON instrument file from i/, p/, s/ directories
 * 3. Extracts base64 audio → WAV files with SHA256 dedup
 * 4. Creates preset.json for each instrument
 * 5. Organizes by source library first, then GM category
 * 6. Generates per-library index.json files (generic format)
 * 7. Generates root index.json linking to each library
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { createHash } from 'crypto';

// ── Configuration ───────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const SOURCE_DIR = getArg('--source') || '../samples/webaudiofontdata/public';
const OUTPUT_DIR = getArg('--output') || './library-output';
const DRY_RUN = args.includes('--dry-run');
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : Infinity;

// ── GM Category Mapping ─────────────────────────────────────

const GM_CATEGORIES = [
    'piano', 'piano', 'piano', 'piano', 'piano', 'piano', 'piano', 'piano',
    'chromatic-percussion', 'chromatic-percussion', 'chromatic-percussion', 'chromatic-percussion',
    'chromatic-percussion', 'chromatic-percussion', 'chromatic-percussion', 'chromatic-percussion',
    'organ', 'organ', 'organ', 'organ', 'organ', 'organ', 'organ', 'organ',
    'guitar', 'guitar', 'guitar', 'guitar', 'guitar', 'guitar', 'guitar', 'guitar',
    'bass', 'bass', 'bass', 'bass', 'bass', 'bass', 'bass', 'bass',
    'strings', 'strings', 'strings', 'strings', 'strings', 'strings', 'strings', 'strings',
    'ensemble', 'ensemble', 'ensemble', 'ensemble', 'ensemble', 'ensemble', 'ensemble', 'ensemble',
    'brass', 'brass', 'brass', 'brass', 'brass', 'brass', 'brass', 'brass',
    'reed', 'reed', 'reed', 'reed', 'reed', 'reed', 'reed', 'reed',
    'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe',
    'synth-lead', 'synth-lead', 'synth-lead', 'synth-lead', 'synth-lead', 'synth-lead', 'synth-lead', 'synth-lead',
    'synth-pad', 'synth-pad', 'synth-pad', 'synth-pad', 'synth-pad', 'synth-pad', 'synth-pad', 'synth-pad',
    'synth-effects', 'synth-effects', 'synth-effects', 'synth-effects', 'synth-effects', 'synth-effects', 'synth-effects', 'synth-effects',
    'ethnic', 'ethnic', 'ethnic', 'ethnic', 'ethnic', 'ethnic', 'ethnic', 'ethnic',
    'percussive', 'percussive', 'percussive', 'percussive', 'percussive', 'percussive', 'percussive', 'percussive',
    'sound-effects', 'sound-effects', 'sound-effects', 'sound-effects', 'sound-effects', 'sound-effects', 'sound-effects', 'sound-effects',
];

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiToNoteName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    const note = midi % 12;
    return `${NOTE_NAMES[note]}${octave}`;
}

// ── Audio Extraction ────────────────────────────────────────

// Global dedup map: sha256 -> { filename, count }
const audioHashes = new Map();
let totalDedupSaved = 0;

/**
 * Extract base64 audio from a zone and write to a file.
 * Returns the filename (relative to preset dir).
 */
function extractAudio(zone, presetDir, zoneIndex, noteName) {
    const audioData = zone.file || zone.sample;
    if (!audioData) return null;

    const isFile = !!zone.file; // MP3 or compressed
    const buffer = Buffer.from(audioData, 'base64');
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);

    // Determine codec from content
    let codec = 'wav';
    let ext = 'wav';
    if (isFile) {
        // Check MP3 magic bytes (ID3 or MPEG sync word)
        if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
            codec = 'mp3'; ext = 'mp3';
        } else if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
            codec = 'mp3'; ext = 'mp3';
        } else if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67) {
            codec = 'ogg'; ext = 'ogg';
        }
    } else {
        // Raw PCM sample — we'll write as-is (raw 16-bit PCM)
        codec = 'raw';
        ext = 'raw';
    }

    const filename = `zone_${noteName}.${ext}`;
    const filepath = join(presetDir, filename);

    // Dedup check
    const hashKey = hash;
    if (audioHashes.has(hashKey)) {
        audioHashes.get(hashKey).count++;
        totalDedupSaved++;
    } else {
        audioHashes.set(hashKey, { filename, count: 1 });
    }

    if (!DRY_RUN) {
        writeFileSync(filepath, buffer);
    }

    return { filename, codec, sha256: hash };
}

// ── Pitch Normalization ─────────────────────────────────────

function normalizePitch(zone) {
    const originalPitch = zone.originalPitch || 6000;
    const coarseTune = zone.coarseTune || 0;
    const fineTune = zone.fineTune || 0;

    // base_detune = originalPitch - 100 * coarseTune - fineTune
    const baseDetune = originalPitch - 100 * coarseTune - fineTune;
    const rootNote = Math.max(0, Math.min(127, Math.floor(baseDetune / 100)));
    const fineTuneCents = baseDetune % 100;

    return { rootNote, fineTuneCents };
}

// ── Zone Conversion ─────────────────────────────────────────

function convertZone(zone, presetDir, zoneIndex) {
    const { rootNote, fineTuneCents } = normalizePitch(zone);
    const noteName = midiToNoteName(rootNote);

    const audioInfo = extractAudio(zone, presetDir, zoneIndex, noteName);
    if (!audioInfo) return null;

    const converted = {
        keyRange: {
            low: zone.keyRangeLow ?? 0,
            high: zone.keyRangeHigh ?? 127,
        },
        pitch: {
            rootNote,
            fineTuneCents,
        },
        sampleRate: zone.sampleRate || 44100,
        audio: {
            type: 'external',
            url: audioInfo.filename,
            codec: audioInfo.codec,
            sha256: audioInfo.sha256,
        },
    };

    // Add loop points if present and valid
    if (zone.loopStart != null && zone.loopEnd != null &&
        zone.loopStart >= 0 && zone.loopEnd > zone.loopStart) {
        converted.loop = { start: zone.loopStart, end: zone.loopEnd };
    }

    return converted;
}

// ── Instrument Conversion ───────────────────────────────────

function convertInstrument(filePath, gmProgram, instrumentName, libraryName, variant) {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const zones = data.zones || [];

    if (zones.length === 0) return null;

    const isPercussion = zones.some(z => z.midi === 128);
    const category = isPercussion ? 'percussion' : GM_CATEGORIES[gmProgram] || 'unknown';

    // Create a safe directory name (WITHOUT library prefix — library is the parent dir)
    const safeName = instrumentName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
    const safeLib = libraryName.replace(/[^a-zA-Z0-9]/g, '_');

    // Output: {Library}/instruments/{category}/{Name}/ or {Library}/percussion/individual/{Name}/
    let presetPath;
    if (isPercussion) {
        presetPath = join(OUTPUT_DIR, safeLib, 'percussion', 'individual', safeName);
    } else {
        presetPath = join(OUTPUT_DIR, safeLib, 'instruments', category, safeName);
    }

    if (!DRY_RUN) {
        mkdirSync(presetPath, { recursive: true });
    }

    // Convert all zones
    const convertedZones = [];
    for (let i = 0; i < zones.length; i++) {
        const z = convertZone(zones[i], presetPath, i);
        if (z) convertedZones.push(z);
    }

    if (convertedZones.length === 0) return null;

    // Build tags
    const tags = [];
    tags.push(isPercussion ? 'percussion' : 'melodic');
    if (!isPercussion) tags.push(category);
    tags.push(`gm:${gmProgram}`);

    // Check for loop support
    if (convertedZones.some(z => z.loop)) tags.push('sustained', 'looped');
    else tags.push('one-shot');

    const preset = {
        format: 'songwalker-preset',
        version: 1,
        name: instrumentName,
        category: 'sampler',
        tags,
        metadata: {
            gmProgram,
            gmCategory: isPercussion ? 'Percussion' : GM_CATEGORIES[gmProgram],
            source: libraryName,
            variant,
            license: 'See original SF2 license',
        },
        node: {
            type: 'sampler',
            config: {
                oneShot: isPercussion,
                zones: convertedZones,
            },
        },
    };

    if (!DRY_RUN) {
        writeFileSync(
            join(presetPath, 'preset.json'),
            JSON.stringify(preset, null, 2)
        );
    }

    // Return path relative to library folder (e.g., instruments/piano/Acoustic_Grand_Piano/preset.json)
    const libraryDir = join(OUTPUT_DIR, safeLib);
    const relativePath = presetPath.replace(libraryDir + '/', '') + '/preset.json';

    return {
        name: instrumentName,
        path: relativePath,
        category: 'sampler',
        tags,
        gmProgram,
        library: safeLib,
        zoneCount: convertedZones.length,
        keyRange: {
            low: Math.min(...convertedZones.map(z => z.keyRange.low)),
            high: Math.max(...convertedZones.map(z => z.keyRange.high)),
        },
    };
}

// ── Instrument File Parsing ─────────────────────────────────

function parseInstrumentFilename(filename) {
    // Pattern: {XXXX}_{Library}_{sf2}[_file].json
    // XXXX / 10 = GM program, XXXX % 10 = variant
    const match = filename.match(/^(\d{4})_(.+?)(?:_sf2(?:_file)?)?\.json$/);
    if (!match) return null;

    const code = parseInt(match[1]);
    const library = match[2];
    const gmProgram = Math.floor(code / 10);
    const variant = code % 10;

    return { gmProgram, variant, library };
}

function parsePercussionFilename(filename) {
    // Pattern: {NN}_{X}_{Library}...json
    const match = filename.match(/^(\d+)_(\d+)_(.+?)(?:_sf2(?:_file)?)?\.json$/);
    if (!match) return null;

    const midiNote = parseInt(match[1]);
    const variant = parseInt(match[2]);
    const library = match[3];

    return { midiNote, variant, library };
}

// ── Main Conversion Pipeline ────────────────────────────────

function main() {
    console.log('SongWalker Preset Converter');
    console.log(`Source:  ${SOURCE_DIR}`);
    console.log(`Output:  ${OUTPUT_DIR}`);
    console.log(`Dry run: ${DRY_RUN}`);
    console.log();

    // Load GM instrument names
    let instrumentNames;
    try {
        instrumentNames = JSON.parse(readFileSync(join(SOURCE_DIR, 'instrumentNames.json'), 'utf-8'));
    } catch (e) {
        console.error('Could not load instrumentNames.json:', e.message);
        process.exit(1);
    }

    // Create base output dir
    if (!DRY_RUN) {
        mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // catalogEntries grouped by library: Map<libraryName, entry[]>
    const entriesByLibrary = new Map();
    let convertedCount = 0;
    let errorCount = 0;

    // ── Convert instrument files (i/) ──
    const instrumentDir = join(SOURCE_DIR, 'i');
    if (existsSync(instrumentDir)) {
        const files = readdirSync(instrumentDir).filter(f => f.endsWith('.json')).sort();
        console.log(`Found ${files.length} instrument files`);

        for (const file of files) {
            if (convertedCount >= LIMIT) break;

            const info = parseInstrumentFilename(file);
            if (!info || info.gmProgram >= 128) continue;

            const name = instrumentNames[info.gmProgram] || `Program ${info.gmProgram}`;
            // Strip category suffix from name (e.g., "Harpsichord: Piano" → "Harpsichord")
            const cleanName = name.split(':')[0].trim();

            try {
                const entry = convertInstrument(
                    join(instrumentDir, file),
                    info.gmProgram,
                    cleanName,
                    info.library,
                    info.variant
                );
                if (entry) {
                    const lib = entry.library;
                    if (!entriesByLibrary.has(lib)) entriesByLibrary.set(lib, []);
                    entriesByLibrary.get(lib).push(entry);
                    convertedCount++;
                    if (convertedCount % 50 === 0) {
                        console.log(`  Converted ${convertedCount} instruments...`);
                    }
                }
            } catch (e) {
                console.error(`  Error converting ${file}: ${e.message}`);
                errorCount++;
            }
        }
    }

    // ── Convert percussion files (p/) ──
    const percussionDir = join(SOURCE_DIR, 'p');
    if (existsSync(percussionDir)) {
        const files = readdirSync(percussionDir).filter(f => f.endsWith('.json')).sort();
        console.log(`Found ${files.length} percussion files`);

        let percCount = 0;
        for (const file of files) {
            if (convertedCount >= LIMIT) break;

            const info = parsePercussionFilename(file);
            if (!info) continue;

            const noteName = midiToNoteName(info.midiNote);

            try {
                const entry = convertInstrument(
                    join(percussionDir, file),
                    128, // sentinel for percussion
                    `Percussion_${noteName}_${info.midiNote}`,
                    info.library,
                    info.variant
                );
                if (entry) {
                    // Override category tags for percussion
                    entry.tags = ['percussion', `midi:${info.midiNote}`];

                    const lib = entry.library;
                    if (!entriesByLibrary.has(lib)) entriesByLibrary.set(lib, []);
                    entriesByLibrary.get(lib).push(entry);
                    convertedCount++;
                    percCount++;
                    if (percCount % 100 === 0) {
                        console.log(`  Converted ${percCount} percussion files...`);
                    }
                }
            } catch (e) {
                console.error(`  Error converting ${file}: ${e.message}`);
                errorCount++;
            }
        }
    }

    // ── Write per-library indexes (generic format) ──
    console.log();
    console.log(`Total converted: ${convertedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Unique audio files: ${audioHashes.size}`);
    console.log(`Dedup savings: ${totalDedupSaved} duplicates skipped`);
    console.log(`Libraries: ${entriesByLibrary.size}`);

    const rootEntries = [];

    for (const [libraryName, entries] of entriesByLibrary) {
        // Build per-library index
        const libraryIndex = {
            format: 'songwalker-index',
            version: 1,
            name: libraryName.replace(/_/g, ' '),
            description: `${libraryName} soundfont — ${entries.length} presets`,
            entries: entries.map(e => ({
                type: 'preset',
                name: e.name,
                path: e.path,
                category: e.category,
                tags: e.tags,
                ...(e.gmProgram < 128 ? { gmProgram: e.gmProgram } : {}),
                zoneCount: e.zoneCount,
                keyRange: e.keyRange,
            })),
        };

        if (!DRY_RUN) {
            writeFileSync(
                join(OUTPUT_DIR, libraryName, 'index.json'),
                JSON.stringify(libraryIndex, null, 2)
            );
        }

        console.log(`  Wrote ${libraryName}/index.json (${entries.length} presets)`);

        // Add to root index
        rootEntries.push({
            type: 'index',
            name: libraryName.replace(/_/g, ' '),
            path: `${libraryName}/index.json`,
            description: `${libraryName} soundfont`,
            presetCount: entries.length,
        });
    }

    // ── Write root index ──
    if (!DRY_RUN) {
        const rootIndex = {
            format: 'songwalker-index',
            version: 1,
            name: 'SongWalker Library',
            description: 'Root index — select a source library to browse its presets',
            entries: rootEntries,
        };
        writeFileSync(
            join(OUTPUT_DIR, 'index.json'),
            JSON.stringify(rootIndex, null, 2)
        );
        console.log(`Wrote root index.json with ${rootEntries.length} libraries`);
    } else {
        console.log(`(Dry run — ${entriesByLibrary.size} library indexes would be written)`);
    }
}

main();
