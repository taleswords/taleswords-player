// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The static-page mount, exercised through the built script-tag bundle. package.test.ts
// deletes and rebuilds build/ while spec files run in parallel, so this spec never reads
// build/: it builds a private copy of the bundle into a temporary directory.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type PlayerState = 'ready' | 'unavailable' | 'error'
type PlayerHandle = { unmount(): void; ready: Promise<PlayerState> }
type TaleswordsPlayerGlobal = {
    mount(element: Element, options: { projectId: string; apiBase: string }): PlayerHandle
}

const START_BODY = { type: 'line', nodeId: 'n1', choices: [], isEnded: false, isTerminal: false, callStack: [] }
const NOT_FOUND_BODY = { errors: [{ message: 'Project not found' }] }

let outDir = ''
let bundle = ''
let player: TaleswordsPlayerGlobal

function startResponse(): Response {
    return new Response(JSON.stringify(START_BODY), { status: 200 })
}

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

describe('TaleswordsPlayer.mount from the script-tag bundle', () => {
    it('[a] gains the player shell and makes one anonymous GET to the start read', async () => {
        const fetchStub = vi.fn(async () => startResponse())
        vi.stubGlobal('fetch', fetchStub)
        const element = host()

        const handle = player.mount(element, { projectId: 'p 1', apiBase: 'http://127.0.0.1:3358/' })

        expect(element.querySelectorAll('[data-taleswords-player]')).toHaveLength(1)
        expect(element.children).toHaveLength(1)
        expect(fetchStub).toHaveBeenCalledTimes(1)
        const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('http://127.0.0.1:3358/api/v1/runtime/projects/p%201/start')
        expect(init.credentials).toBe('omit')
        expect(init).not.toHaveProperty('headers')

        expect(await handle.ready).toBe('ready')
        expect(element.querySelector('[data-taleswords-player]')!.getAttribute('data-state')).toBe('ready')
    })

    it("[a'] shows the not-available state when the read answers 404", async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify(NOT_FOUND_BODY), { status: 404 }))
        )
        const element = host()

        const handle = player.mount(element, { projectId: 'p1', apiBase: 'http://127.0.0.1:3358' })

        expect(await handle.ready).toBe('unavailable')
        expect(element.querySelector('[data-taleswords-player]')!.getAttribute('data-state')).toBe('unavailable')
    })

    it('[b] unmount empties the host, aborts a pending read, ignores its late answer, and adds no listener', async () => {
        const element = host()
        const listenerSpies = [
            vi.spyOn(element, 'addEventListener'),
            vi.spyOn(document, 'addEventListener'),
            vi.spyOn(window, 'addEventListener')
        ]

        // (1) unmount after the read has settled
        vi.stubGlobal('fetch', vi.fn(async () => startResponse()))
        const settled = player.mount(element, { projectId: 'p1', apiBase: 'http://127.0.0.1:3358' })
        expect(await settled.ready).toBe('ready')
        settled.unmount()
        expect(element.innerHTML).toBe('')

        // (2) unmount while the read is pending
        let answer: (response: Response) => void = () => {}
        let signal: AbortSignal | undefined
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: string, init: RequestInit) => {
                signal = init.signal ?? undefined
                return new Promise<Response>((resolveAnswer) => {
                    answer = resolveAnswer
                })
            })
        )
        const pending = player.mount(element, { projectId: 'p1', apiBase: 'http://127.0.0.1:3358' })
        expect(element.querySelector('[data-taleswords-player]')!.getAttribute('data-state')).toBe('loading')
        pending.unmount()
        expect(signal?.aborted).toBe(true)
        expect(element.innerHTML).toBe('')
        expect(await pending.ready).toBe('error')
        answer(startResponse())
        await new Promise((resolveTick) => setTimeout(resolveTick, 0))
        expect(element.innerHTML).toBe('')

        // (3) a second mount on the same host replaces the first
        vi.stubGlobal('fetch', vi.fn(async () => startResponse()))
        const first = player.mount(element, { projectId: 'p1', apiBase: 'http://127.0.0.1:3358' })
        const second = player.mount(element, { projectId: 'p1', apiBase: 'http://127.0.0.1:3358' })
        expect(element.querySelectorAll('[data-taleswords-player]')).toHaveLength(1)
        expect(await first.ready).toBe('error')
        expect(await second.ready).toBe('ready')
        second.unmount()

        for (const spy of listenerSpies) expect(spy).not.toHaveBeenCalled()
    })

    it('[d] the bundle is non-empty and carries nothing from authoring, no credential and no import(', () => {
        expect(bundle.length).toBeGreaterThan(0)
        for (const forbidden of [
            '/project/:projectId',
            'tw_token',
            'Authorization',
            'Bearer',
            'JWT_SECRET',
            'MONGO_URI',
            'SUPERADMIN_EMAIL',
            'SUPERADMIN_PASSWORD',
            'PEPPER_TOKEN',
            'import('
        ]) {
            expect(bundle, forbidden).not.toContain(forbidden)
        }
    })
})
