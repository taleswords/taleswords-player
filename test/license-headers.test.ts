// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// This package is MIT and public. Every source file opens with the SPDX line, and no file
// carries a proprietary notice copied from elsewhere.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPDX = '// SPDX-License-Identifier: MIT'
const PROPRIETARY = /proprietary|all rights reserved|unauthorized copying/i

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return sources(path)
        return /\.(ts|tsx|js|mjs|cjs|vue|svelte)$/.test(entry.name) ? [path] : []
    })
}

describe('license headers', () => {
    const files = [...sources(join(root, 'src')), ...sources(join(root, 'test'))]
    // this file names the notice it forbids
    const scanned = files.filter((file) => file !== fileURLToPath(import.meta.url))

    it('finds the sources', () => {
        expect(files.length).toBeGreaterThan(0)
    })

    it.each(files.map((file) => [file.slice(root.length + 1), file]))('%s opens with the MIT SPDX line', (_name, file) => {
        expect(readFileSync(file, 'utf8').split('\n', 1)[0]).toBe(SPDX)
    })

    it.each(scanned.map((file) => [file.slice(root.length + 1), file]))('%s carries no proprietary notice', (_name, file) => {
        expect(readFileSync(file, 'utf8')).not.toMatch(PROPRIETARY)
    })
})
