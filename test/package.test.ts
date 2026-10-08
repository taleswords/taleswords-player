// SPDX-License-Identifier: MIT

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')

const ENTRIES = ['index', 'contract', 'reader', 'components', 'browser']
const SUFFIXES = ['.js', '.d.ts', '.js.map', '.d.ts.map']
const EXPECTED_BUILD_FILES = ENTRIES.flatMap((entry) => SUFFIXES.map((suffix) => `${entry}${suffix}`)).sort()

type PackageJson = Record<string, unknown>
type PackResult = { files: Array<{ path: string }> }

describe('@taleswords/player package', () => {
    let buildExitCode: number | null = null
    let buildOutput = ''

    beforeAll(() => {
        try {
            buildOutput = execSync('npm run build', { cwd: root, encoding: 'utf8', stdio: 'pipe' })
            buildExitCode = 0
        } catch (error) {
            const failure = error as { status?: number | null; stdout?: string; stderr?: string }
            buildExitCode = failure.status ?? 1
            buildOutput = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
        }
    }, 180_000)

    it('builds one .js, .d.ts and map pair per source entry into build/', () => {
        expect(buildExitCode, buildOutput).toBe(0)
        expect(readdirSync(buildDir).sort()).toEqual(EXPECTED_BUILD_FILES)
    })

    it('packs package.json, README, LICENSE and the build/ files only', () => {
        const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        })
        // npm answers an array of packs on older majors and an object keyed by package name on newer ones
        const parsed = JSON.parse(raw) as PackResult[] | Record<string, PackResult>
        const packs = Array.isArray(parsed) ? parsed : Object.values(parsed)
        expect(packs).toHaveLength(1)
        const paths = packs[0]!.files.map((file) => file.path).sort()

        expect(paths).toEqual(
            ['LICENSE', 'README.md', 'package.json', ...EXPECTED_BUILD_FILES.map((file) => `build/${file}`)].sort()
        )
    })

    it('publishes @taleswords/player with public access and every export resolves into build/', () => {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson
        expect(pkg.name).toBe('@taleswords/player')
        expect(pkg.license).toBe('MIT')
        expect((pkg.publishConfig as { access?: string } | undefined)?.access).toBe('public')

        const exportsMap = pkg.exports as Record<string, { types?: string; import?: string }>
        expect(Object.keys(exportsMap).sort()).toEqual(['.', './browser', './components'])
        for (const [subpath, target] of Object.entries(exportsMap)) {
            for (const condition of ['types', 'import'] as const) {
                const file = target[condition]
                expect(file, `${subpath} ${condition}`).toMatch(/^\.\/build\//)
                expect(existsSync(join(root, file!)), `${subpath} ${condition} -> ${file}`).toBe(true)
            }
        }
    })
})

describe('readerLink', () => {
    it('builds the reader URL under the given base and ignores trailing slashes', async () => {
        const { readerLink, READER_PATH_PATTERN } = await import('../src/reader.js')
        expect(READER_PATH_PATTERN).toBe('/read/:projectId')
        expect(readerLink('p1', 'https://example.org')).toBe('https://example.org/read/p1')
        expect(readerLink('p1', ' https://example.org/stories// ')).toBe('https://example.org/stories/read/p1')
    })
})
