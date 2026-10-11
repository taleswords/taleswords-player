// SPDX-License-Identifier: MIT

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Fixed to this package so vitest does not walk up to the monorepo root's config.
export default defineConfig({
    root: dirname(fileURLToPath(import.meta.url)),
    test: {
        environment: 'happy-dom',
        include: ['test/**/*.test.ts']
    }
})
