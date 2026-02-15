#!/usr/bin/env node
/**
 * generate-index.js
 *
 * Scans a songwalker-library directory organized by source library
 * and generates per-library + root index files using the generic
 * songwalker-index format.
 *
 * Usage:
 *   node scripts/generate-index.js [library-dir]
 *
 * Default library-dir: ./library-output (or songwalker-library repo root)
 *
 * Designed to run as a Husky pre-commit hook:
 *   .husky/pre-commit: node scripts/generate-index.js
 *
 * Expected directory layout:
 *   library-dir/
 *     FluidR3_GM/
 *       instruments/piano/Acoustic_Grand_Piano/preset.json
 *       percussion/individual/Percussion_C3_60/preset.json
 *     Aspirin/
 *       instruments/...
 *     _shared/
 *       effects/Reverb/preset.json
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, relative } from 'path';

const LIBRARY_DIR = process.argv[2] || './library-output';

// Directories to skip when scanning for library folders
const SKIP_DIRS = new Set(['.git', '.husky', 'scripts', 'node_modules', '.github']);

// ── Helpers ─────────────────────────────────────────────────

function findPresetFiles(dir, results = []) {
    if (!existsSync(dir)) return results;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            findPresetFiles(fullPath, results);
        } else if (entry.name === 'preset.json') {
            results.push(fullPath);
        }
    }
    return results;
}

function buildPresetEntry(presetPath, libraryRoot) {
    const data = JSON.parse(readFileSync(presetPath, 'utf-8'));
    const relPath = relative(libraryRoot, presetPath).replace(/\\/g, '/');

    // Extract zone stats from the node tree
    let zoneCount = 0;
    let keyRangeLow = 127;
    let keyRangeHigh = 0;

    function countZones(node) {
        if (!node) return;
        if (node.type === 'sampler' && node.config?.zones) {
            for (const zone of node.config.zones) {
                zoneCount++;
                if (zone.keyRange) {
                    keyRangeLow = Math.min(keyRangeLow, zone.keyRange.low);
                    keyRangeHigh = Math.max(keyRangeHigh, zone.keyRange.high);
                }
            }
        }
        if (node.type === 'composite' && node.children) {
            for (const child of node.children) {
                countZones(child);
            }
        }
    }
    countZones(data.node || data.graph); // support both old (graph) and new (node) format

    const entry = {
        type: 'preset',
        name: data.name,
        path: relPath,
        category: data.category || 'sampler',
        tags: data.tags || [],
    };

    // Optional fields
    const gm = data.metadata?.gmProgram;
    if (gm != null && gm < 128) entry.gmProgram = gm;
    if (zoneCount > 0) {
        entry.zoneCount = zoneCount;
        entry.keyRange = { low: keyRangeLow, high: keyRangeHigh };
    }

    return entry;
}

// ── Main ────────────────────────────────────────────────────

function main() {
    console.log(`Scanning ${LIBRARY_DIR} for library directories...`);

    // Find top-level library directories
    const topLevel = readdirSync(LIBRARY_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
        .map(e => e.name)
        .sort();

    console.log(`Found ${topLevel.length} libraries: ${topLevel.join(', ')}`);

    const rootEntries = [];
    let totalPresets = 0;
    let totalErrors = 0;

    for (const libraryName of topLevel) {
        const libraryDir = join(LIBRARY_DIR, libraryName);
        const presetFiles = findPresetFiles(libraryDir);
        console.log(`  ${libraryName}: ${presetFiles.length} presets`);

        const presetEntries = [];
        let errors = 0;

        for (const file of presetFiles) {
            try {
                const entry = buildPresetEntry(file, libraryDir);
                presetEntries.push(entry);
            } catch (e) {
                console.error(`    Error reading ${file}: ${e.message}`);
                errors++;
            }
        }

        // Sort by category, then name
        presetEntries.sort((a, b) => {
            const catCmp = (a.category || '').localeCompare(b.category || '');
            if (catCmp !== 0) return catCmp;
            return (a.name || '').localeCompare(b.name || '');
        });

        // Write per-library index.json
        const displayName = libraryName === '_shared' ? 'Built-in' : libraryName.replace(/_/g, ' ');
        const libraryDescription = libraryName === '_shared'
            ? `Built-in oscillator synths and effects — ${presetEntries.length} presets`
            : `${displayName} soundfont — ${presetEntries.length} presets`;
        const libraryIndex = {
            format: 'songwalker-index',
            version: 1,
            name: displayName,
            description: libraryDescription,
            entries: presetEntries,
        };

        const libraryIndexPath = join(libraryDir, 'index.json');
        writeFileSync(libraryIndexPath, JSON.stringify(libraryIndex, null, 2));

        const sizeKB = (Buffer.byteLength(JSON.stringify(libraryIndex)) / 1024).toFixed(1);
        console.log(`    Wrote ${libraryName}/index.json (${presetEntries.length} entries, ${sizeKB} KB)`);

        // Add to root index
        const rootDescription = libraryName === '_shared'
            ? 'Built-in oscillator synths and effects (no samples)'
            : `${displayName} soundfont`;
        rootEntries.push({
            type: 'index',
            name: displayName,
            path: `${libraryName}/index.json`,
            description: rootDescription,
            presetCount: presetEntries.length,
        });

        totalPresets += presetEntries.length;
        totalErrors += errors;
    }

    // Write root index.json
    const rootIndex = {
        format: 'songwalker-index',
        version: 1,
        name: 'SongWalker Library',
        description: 'Root index — select a source library to browse its presets',
        entries: rootEntries,
    };

    const rootIndexPath = join(LIBRARY_DIR, 'index.json');
    writeFileSync(rootIndexPath, JSON.stringify(rootIndex, null, 2));

    const rootSizeKB = (Buffer.byteLength(JSON.stringify(rootIndex)) / 1024).toFixed(1);
    console.log();
    console.log(`Generated root index.json (${rootEntries.length} libraries, ${rootSizeKB} KB)`);
    console.log(`Total: ${totalPresets} presets across ${topLevel.length} libraries`);
    if (totalErrors > 0) console.log(`Errors: ${totalErrors}`);
}

main();
