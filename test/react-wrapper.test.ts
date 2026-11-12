// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TaleswordsPlayer, type TaleswordsPlayerProps } from '../src/react.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The reader's walk as a React site gets it: TaleswordsPlayer, imported from src, rendered by
// react-dom/client createRoot inside act into a host div under happy-dom, with fetch stubbed.
// No testing library and no JSX: the elements are built with createElement. Nothing here reads
// build/, which package.test.ts deletes and rebuilds while the spec files run in parallel.
// The harness (stubFetch, host, settled, afterEach) is copied from vue-wrapper.test.ts.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const API_BASE = 'http://127.0.0.1:3358/'
const START_URL = 'http://127.0.0.1:3358/api/v1/runtime/projects/p1/start'

const LINE_1 = {
    type: 'line',
    nodeId: 'n1',
    rootContainerId: 'scene-root',
    rootContainerType: 'scene',
    text: 'The gate is shut.',
    choices: [
        { choiceId: 'c1', label: 'Knock' },
        { choiceId: 'c3', label: 'Walk away' }
    ],
    isEnded: false,
    isTerminal: false,
    callStack: []
}

const LINE_2 = {
    type: 'line',
    nodeId: 'n2',
    rootContainerId: 'scene-root',
    rootContainerType: 'scene',
    text: 'Someone answers.',
    choices: [],
    isEnded: false,
    isTerminal: false,
    callStack: []
}

type Answer = { status: number; body: unknown }

/** A fetch stub that answers each call with the next queued answer, in order. */
function stubFetch(...answers: Answer[]) {
    const queue = [...answers]
    const stub = vi.fn(async (_url: string, _init: RequestInit) => {
        const next = queue.shift()
        if (!next) throw new Error('no answer queued for this request')
        return new Response(JSON.stringify(next.body), { status: next.status })
    })
    vi.stubGlobal('fetch', stub)
    return stub
}

function ok(body: unknown): Answer {
    return { status: 200, body }
}

function call(stub: ReturnType<typeof stubFetch>, index: number): [string, RequestInit] {
    return stub.mock.calls[index] as unknown as [string, RequestInit]
}

function host(): HTMLElement {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

function shell(element: Element): Element {
    return element.querySelector('[data-taleswords-player]')!
}

async function settled(element: Element, state: string): Promise<void> {
    await vi.waitFor(() => expect(shell(element)?.getAttribute('data-state')).toBe(state))
}

function tick(): Promise<void> {
    return new Promise(resolveTick => setTimeout(resolveTick, 0))
}

/** The React roots still mounted, unmounted after each test. */
const roots: Root[] = []

/** A React root on the host, tracked so afterEach unmounts it if the test did not. */
function rootOn(element: Element): Root {
    const root = createRoot(element)
    roots.push(root)
    return root
}

/** A React site rendering the wrapper into its root, as a site would. */
async function render(root: Root, props: TaleswordsPlayerProps): Promise<void> {
    await act(async () => {
        root.render(createElement(TaleswordsPlayer, props))
    })
}

async function unmountRoot(root: Root): Promise<void> {
    roots.splice(roots.indexOf(root), 1)
    await act(async () => {
        root.unmount()
    })
}

let consoleError: MockInstance<typeof console.error>

beforeEach(() => {
    consoleError = vi.spyOn(console, 'error')
})

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await act(async () => {
            root.unmount()
        })
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe("the reader's walk through the React TaleswordsPlayer", () => {
    it("[a1] renders one div holding the shell, sends one anonymous GET of the start with credentials omitted, settles ready and onState hears 'ready'", async () => {
        const stub = stubFetch(ok(LINE_1))
        const element = host()
        const onState = vi.fn()

        await render(rootOn(element), { projectId: 'p1', apiBase: API_BASE, onState })
        await settled(element, 'ready')

        expect(element.children).toHaveLength(1)
        const wrapperDiv = element.children[0]!
        expect(wrapperDiv.tagName).toBe('DIV')
        expect(wrapperDiv.children).toHaveLength(1)
        expect(wrapperDiv.children[0]!.hasAttribute('data-taleswords-player')).toBe(true)
        expect(shell(element).parentElement).toBe(wrapperDiv)
        expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_1.text)

        expect(stub).toHaveBeenCalledTimes(1)
        const [url, init] = call(stub, 0)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
        expect(init).not.toHaveProperty('headers')
        expect(init).not.toHaveProperty('body')

        await tick()
        expect(onState).toHaveBeenCalledTimes(1)
        expect(onState).toHaveBeenCalledWith('ready')
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('[a2] unmount empties the host and aborts a pending start whose late answer writes nothing; no DOM listener is added; an equal copy does not remount and a changed projectId does', async () => {
        const settledHost = host()
        const pendingHost = host()
        const propsHost = host()
        // createRoot binds React's own event delegation on its container before the wrapper exists;
        // the roots are made first, so the spies below see only what rendering, the wrapper and mount add.
        const settledRoot = rootOn(settledHost)
        const pendingRoot = rootOn(pendingHost)
        const propsRoot = rootOn(propsHost)

        // As in [s11]: the addEventListener every host, document and window inherit, each owner spied once,
        // so the wrapper divs React creates later (and every other node) are bound through the same spy.
        const owners = new Set<object>()
        for (const target of [settledHost, pendingHost, propsHost, document, window] as object[]) {
            let owner: object | null = target
            while (owner && !Object.prototype.hasOwnProperty.call(owner, 'addEventListener')) owner = Object.getPrototypeOf(owner)
            owners.add(owner!)
        }
        const spies = [...owners].map(owner => vi.spyOn(owner as EventTarget, 'addEventListener'))
        for (const target of [settledHost, document, window]) expect(vi.isMockFunction(target.addEventListener)).toBe(true)
        const wrapperDivs: Element[] = []

        // (1) unmount after the start read has settled: the host is empty and onState hears nothing more
        stubFetch(ok(LINE_1))
        const settledHeard = vi.fn()
        await render(settledRoot, { projectId: 'p1', apiBase: API_BASE, onState: settledHeard })
        await settled(settledHost, 'ready')
        expect(settledHeard.mock.calls).toEqual([['ready']])
        wrapperDivs.push(settledHost.children[0]!)
        expect(vi.isMockFunction(settledHost.children[0]!.addEventListener)).toBe(true)

        await unmountRoot(settledRoot)
        expect(settledHost.children).toHaveLength(0)
        expect(settledHost.innerHTML).toBe('')
        await tick()
        expect(settledHeard.mock.calls).toEqual([['ready']])

        // (2) unmount while the start read is pending, after which it answers
        let answer: (response: Response) => void = () => {}
        let signal: AbortSignal | undefined
        const pendingFetch = vi.fn((_url: string, init: RequestInit) => {
            signal = init.signal ?? undefined
            return new Promise<Response>(resolveAnswer => {
                answer = resolveAnswer
            })
        })
        vi.stubGlobal('fetch', pendingFetch)
        const pendingHeard = vi.fn()
        await render(pendingRoot, { projectId: 'p1', apiBase: API_BASE, onState: pendingHeard })
        expect(shell(pendingHost).getAttribute('data-state')).toBe('loading')
        wrapperDivs.push(pendingHost.children[0]!)
        expect(signal?.aborted).toBe(false)

        await unmountRoot(pendingRoot)
        expect(signal?.aborted).toBe(true)
        expect(pendingHost.children).toHaveLength(0)
        expect(pendingHost.innerHTML).toBe('')
        answer(new Response(JSON.stringify(LINE_1), { status: 200 }))
        await tick()
        await tick()
        expect(pendingFetch).toHaveBeenCalledTimes(1)
        expect(pendingHost.innerHTML).toBe('')
        expect(pendingHeard).not.toHaveBeenCalled()

        // (3) a re-render with an equal inline copy object, built anew as an author's inline prop is
        const stub = stubFetch(ok(LINE_1), ok(LINE_2))
        await render(propsRoot, { projectId: 'p1', apiBase: API_BASE, copy: { continue: 'Go on' } })
        await settled(propsHost, 'ready')
        const firstShell = shell(propsHost)
        wrapperDivs.push(propsHost.children[0]!)

        await render(propsRoot, { projectId: 'p1', apiBase: API_BASE, copy: { continue: 'Go on' } })
        await tick()
        expect(stub).toHaveBeenCalledTimes(1)
        expect(shell(propsHost)).toBe(firstShell)
        expect(shell(propsHost).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_1.text)

        // (4) a changed projectId mounts the player again for the new story
        await render(propsRoot, { projectId: 'p2', apiBase: API_BASE, copy: { continue: 'Go on' } })
        await vi.waitFor(() => expect(shell(propsHost).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text))
        expect(stub).toHaveBeenCalledTimes(2)
        expect(call(stub, 0)[0]).toBe(START_URL)
        const [url, init] = call(stub, 1)
        expect(url).toBe(START_URL.replace('/projects/p1/', '/projects/p2/'))
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
        expect(propsHost.children).toHaveLength(1)
        expect(propsHost.children[0]).toBe(wrapperDivs[2])
        expect(propsHost.children[0]!.children).toHaveLength(1)

        // No listener on a host, a wrapper div, document or window; the player's own buttons do not count.
        const targets = spies.flatMap(spy => spy.mock.contexts as unknown[])
        for (const [target, name] of [
            [settledHost, 'settled host'],
            [pendingHost, 'pending host'],
            [propsHost, 'props host'],
            [wrapperDivs[0]!, 'settled wrapper div'],
            [wrapperDivs[1]!, 'pending wrapper div'],
            [wrapperDivs[2]!, 'props wrapper div'],
            [document, 'document'],
            [window, 'window']
        ] as const) {
            expect(targets.some(context => context === target), name).toBe(false)
        }
        for (const context of targets) expect((context as Element).tagName).toBe('BUTTON')
        // The spy is live: the player's choice buttons were bound through it.
        expect(targets.some(context => (context as Element).tagName === 'BUTTON')).toBe(true)

        expect(consoleError).not.toHaveBeenCalled()
    })

    it("[a3] package.json exports './react' from build/ and declares react, not react-dom, as an optional peer", () => {
        const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
            exports?: Record<string, unknown>
            peerDependencies?: Record<string, string>
            peerDependenciesMeta?: Record<string, { optional?: boolean }>
        }

        expect(pkg.exports?.['./react']).toEqual({ types: './build/react.d.ts', import: './build/react.js' })
        expect(pkg.peerDependencies?.react).toBe('^18.0.0 || ^19.0.0')
        expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true)
        expect(pkg.peerDependencies).not.toHaveProperty('react-dom')
        expect(consoleError).not.toHaveBeenCalled()
    })

    it("[a4] src/react.ts opens with the MIT SPDX line, names no credential, dashboard or backend, and imports only 'react' and './browser.js'", () => {
        const source = readFileSync(join(packageRoot, 'src', 'react.ts'), 'utf8')

        expect(source.split('\n', 1)[0]).toBe('// SPDX-License-Identifier: MIT')
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
            'import(',
            'dashboard',
            'backend',
            'react-dom'
        ]) {
            expect(source, forbidden).not.toContain(forbidden)
        }

        const specifiers = new Set<string>()
        for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.add(match[1]!)
        for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specifiers.add(match[1]!)
        expect([...specifiers].sort()).toEqual(['./browser.js', 'react'])
        expect(source).not.toContain('require(')
        expect(consoleError).not.toHaveBeenCalled()
    })

    it("[a5] src/react.ts declares itself a client module ('use client' as its first statement), so a Server Components host imports it with no client shim of its own", () => {
        const source = readFileSync(join(packageRoot, 'src', 'react.ts'), 'utf8')
        const lines = source.split('\n').map(line => line.trim())

        let first = 0
        while (first < lines.length && (lines[first] === '' || lines[first]!.startsWith('//'))) first++
        expect(lines[first], 'the first statement of src/react.ts is the client directive').toMatch(/^(['"])use client\1;?$/)

        const firstImport = lines.findIndex(line => line.startsWith('import'))
        expect(firstImport, 'src/react.ts has an import line').toBeGreaterThan(-1)
        expect(first, 'the client directive comes before the first import').toBeLessThan(firstImport)
        expect(consoleError).not.toHaveBeenCalled()
    })
})
