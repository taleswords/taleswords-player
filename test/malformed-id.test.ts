// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The static-page mount on a project id that is not a well-formed id, exercised through
// the built script-tag bundle. package.test.ts deletes and rebuilds build/ while spec files
// run in parallel, so this spec never reads build/: it builds a private copy of the bundle
// into a temporary directory.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type PlayerState = 'ready' | 'unavailable' | 'error'
type PlayerHandle = { unmount(): void; ready: Promise<PlayerState> }
type TaleswordsPlayerGlobal = {
    mount(element: Element, options: { projectId: string; apiBase: string }): PlayerHandle
}

// What the runtime answers today for GET /api/v1/runtime/projects/not-an-id/start.
const MALFORMED_ID_BODY = { errors: [{ message: 'Invalid value for _id', field: '_id' }] }

let outDir = ''
let bundle = ''
let player: TaleswordsPlayerGlobal

function host(): HTMLElement {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'taleswords-player-mount-'))
    await build({
        configFile: join(root, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true }
    })
    bundle = readFileSync(join(outDir, 'player.iife.js'), 'utf8')
    // Evaluated as a script tag would run it: at global scope, leaving the global behind.
    ;(0, eval)(bundle)
    player = (globalThis as unknown as { TaleswordsPlayer: TaleswordsPlayerGlobal }).TaleswordsPlayer
}, 180_000)

afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('TaleswordsPlayer.mount on a malformed project id', () => {
    it('a malformed project id settles error with the error view and Start again', async () => {
        const fetchStub = vi.fn(
            async () =>
                new Response(JSON.stringify(MALFORMED_ID_BODY), {
                    status: 400,
                    headers: { 'content-type': 'application/json' }
                })
        )
        vi.stubGlobal('fetch', fetchStub)
        const element = host()

        const handle = player.mount(element, { projectId: 'not-an-id', apiBase: 'http://127.0.0.1:3358' })

        expect(await handle.ready).toBe('error')
        const shell = element.querySelector('[data-taleswords-player]')!
        expect(shell.getAttribute('data-state')).toBe('error')
        expect(shell.children).toHaveLength(1)
        expect(shell.children[0]!.matches('[data-taleswords-refusal="error"]')).toBe(true)

        const refusals = element.querySelectorAll('[data-taleswords-refusal="error"]')
        expect(refusals).toHaveLength(1)
        expect(refusals[0]!.querySelector('[data-taleswords-error]')!.textContent).toBe('The story could not be loaded.')

        const buttons = element.querySelectorAll('button')
        expect(buttons).toHaveLength(1)
        expect(buttons[0]!.hasAttribute('data-taleswords-restart')).toBe(true)
        expect(buttons[0]!.disabled).toBe(false)
        expect(buttons[0]!.textContent).toBe('Start again')

        expect(fetchStub).toHaveBeenCalledTimes(1)
        const [url] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
        expect(url.endsWith('/api/v1/runtime/projects/not-an-id/start')).toBe(true)
    })
})
