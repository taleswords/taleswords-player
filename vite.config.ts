// SPDX-License-Identifier: MIT

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

// The one-script-tag bundle for static pages. tsc writes the ESM build first; this adds
// build/player.iife.js beside it and leaves tsc's output in place.
export default defineConfig({
    root,
    build: {
        lib: {
            entry: resolve(root, 'src/browser.ts'),
            formats: ['iife'],
            name: 'TaleswordsPlayer',
            fileName: () => 'player.iife.js'
        },
        outDir: 'build',
        emptyOutDir: false,
        sourcemap: false
    }
})
