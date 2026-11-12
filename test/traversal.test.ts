// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The reader's walk in the static-page embed, exercised through the built script-tag
// bundle exactly as mount.test.ts does: a private build into a temporary directory,
// evaluated at global scope, with fetch stubbed by contract-complete runtime states.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type PlayerState = 'ready' | 'unavailable' | 'not-ready' | 'error'
type PlayerHandle = { unmount(): void; ready: Promise<PlayerState> }
type TaleswordsPlayerGlobal = {
    mount(
        element: Element,
        options: { projectId: string; apiBase: string; copy?: Record<string, string>; onState?: (state: string) => void }
    ): PlayerHandle
}

const API_BASE = 'http://127.0.0.1:3358/'
const START_URL = 'http://127.0.0.1:3358/api/v1/runtime/projects/p1/start'

const LINE_1 = {
    type: 'line',
    nodeId: 'n1',
    rootContainerId: 'scene-root',
    rootContainerType: 'scene',
    scene: { id: 's1', imageUrl: '/uploads/scene-1.png' },
    character: { id: 'ch1', name: 'Mira', imageUrl: '/uploads/mira.png' },
    text: 'The gate is <b>shut</b>.',
    choices: [
        { choiceId: 'c1', label: 'Knock' },
        { choiceId: 'c2', label: 'Climb the wall', isUnavailable: true },
        { choiceId: 'c3', label: 'Walk away' }
    ],
    isEnded: false,
    isTerminal: false,
    callStack: [{ nodeId: 'n0', containerId: 'dlg-1', containerType: 'dialogue', sourceRefId: 'ref-1' }]
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
    callStack: [{ nodeId: 'n1', containerId: 'dlg-2', containerType: 'dialogue' }]
}

const LINE_3 = { ...LINE_2, nodeId: 'n3', text: 'The door opens.', callStack: [] }

const AUTHORED_ENDING = {
    type: 'ending',
    reason: 'authored',
    nodeId: 'end-1',
    rootContainerId: 'scene-root',
    rootContainerType: 'scene',
    isEnded: true,
    choices: [],
    callStack: [],
    ending: { title: 'Home at Last', text: 'Mira sleeps by the fire.', imageUrl: '/uploads/ending.png' }
}

const END_OF_ROAD = {
    type: 'ending',
    reason: 'dangling-edge',
    rootContainerId: 'scene-root',
    rootContainerType: 'scene',
    isEnded: true,
    choices: [],
    callStack: []
}

const NOT_FOUND_BODY = { errors: [{ message: 'Project not found' }] }
const NO_MAIN_SCENE_BODY = { errors: [{ message: 'No main scene found', code: 'story_not_ready' }] }
const SERVER_ERROR_BODY = { errors: [{ message: 'something went wrong ' }] }

const REFUSAL_TEXT = 'This story is not available.'

let outDir = ''
let player: TaleswordsPlayerGlobal

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

/** The shell holds the refusal alone: the copy, and nothing of a story. */
function expectRefusal(element: Element, text = REFUSAL_TEXT): void {
    expect(element.children).toHaveLength(1)
    expect(shell(element).getAttribute('data-state')).toBe('unavailable')
    expect(shell(element).children).toHaveLength(1)
    const refusal = shell(element).querySelector('[data-taleswords-refusal="unavailable"]')
    expect(refusal).not.toBeNull()
    expect(refusal!.querySelector('[data-taleswords-unavailable]')?.textContent).toBe(text)
    expect(shell(element).textContent).toBe(text)
    expect(shell(element).querySelector('button, img, [data-taleswords-text]')).toBeNull()
}

/** The shell settled 'error' and holds the error view alone: the copy and one enabled Start again, nothing of a story. */
function expectErrorView(element: Element, text = 'The story could not be loaded.'): void {
    expect(element.children).toHaveLength(1)
    expect(shell(element).getAttribute('data-state')).toBe('error')
    expect(shell(element).children).toHaveLength(1)
    const view = shell(element).children[0]!
    expect(view.matches('[data-taleswords-refusal="error"]')).toBe(true)
    expect(view.querySelector('[data-taleswords-error]')?.textContent).toBe(text)
    const buttons = view.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.hasAttribute('data-taleswords-restart')).toBe(true)
    expect(buttons[0]!.disabled).toBe(false)
    expect(buttons[0]!.textContent).toBe('Start again')
    expect(shell(element).querySelector('img, [data-taleswords-unavailable]')).toBeNull()
}

beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'taleswords-player-traversal-'))
    await build({
        configFile: join(root, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true }
    })
    ;(0, eval)(readFileSync(join(outDir, 'player.iife.js'), 'utf8'))
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

describe("the reader's walk in the script-tag bundle", () => {
    it('[a1] opens the story with one anonymous GET of the start, credentials omitted', async () => {
        const stub = stubFetch(ok(LINE_1))
        const element = host()

        const handle = player.mount(element, { projectId: 'p1', apiBase: API_BASE })

        expect(await handle.ready).toBe('ready')
        expect(stub).toHaveBeenCalledTimes(1)
        const [url, init] = call(stub, 0)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
        expect(init).not.toHaveProperty('headers')
        expect(init).not.toHaveProperty('body')
    })

    it("[a2] shows the line's text as text, never as markup", async () => {
        stubFetch(ok(LINE_1))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')

        const text = shell(element).querySelector('[data-taleswords-text]')
        expect(text).not.toBeNull()
        expect(text!.textContent).toBe('The gate is <b>shut</b>.')
        expect(text!.querySelector('b')).toBeNull()
    })

    it("[a3] shows the scene image, its src resolved against apiBase's origin", async () => {
        stubFetch(ok(LINE_1))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')

        const scene = shell(element).querySelectorAll<HTMLImageElement>('img[data-taleswords-scene]')
        expect(scene).toHaveLength(1)
        expect(scene[0]!.getAttribute('src')).toBe('http://127.0.0.1:3358/uploads/scene-1.png')
    })

    it("[a4] shows the character's portrait, alt the character's name, src resolved against apiBase's origin", async () => {
        stubFetch(ok(LINE_1))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')

        const portrait = shell(element).querySelectorAll<HTMLImageElement>('img[data-taleswords-portrait]')
        expect(portrait).toHaveLength(1)
        expect(portrait[0]!.getAttribute('alt')).toBe('Mira')
        expect(portrait[0]!.getAttribute('src')).toBe('http://127.0.0.1:3358/uploads/mira.png')
    })

    it('[a5] offers the choices in order; the unavailable one is disabled and a click on it fetches nothing', async () => {
        const stub = stubFetch(ok(LINE_1))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')

        const choices = [...shell(element).querySelectorAll<HTMLButtonElement>('button[data-taleswords-choice]')]
        expect(choices.map(choice => choice.textContent)).toEqual(['Knock', 'Climb the wall', 'Walk away'])
        expect(choices.map(choice => choice.disabled)).toEqual([false, true, false])
        expect(shell(element).querySelector('[data-taleswords-continue]')).toBeNull()

        choices[1]!.click()
        // A click event dispatched straight at the control, past the disabled attribute.
        choices[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise(resolveTick => setTimeout(resolveTick, 0))
        expect(stub).toHaveBeenCalledTimes(1)
        expect(shell(element).querySelector('[data-taleswords-text]')!.textContent).toBe(LINE_1.text)
    })

    it("[a6] an advance POSTs next echoing the last state's callStack and root pair, and the next state renders", async () => {
        const element = host()
        const listenerSpies = [
            vi.spyOn(element, 'addEventListener'),
            vi.spyOn(document, 'addEventListener'),
            vi.spyOn(window, 'addEventListener')
        ]
        const stub = stubFetch(ok(LINE_1), ok(LINE_2), ok(LINE_3))

        const handle = player.mount(element, { projectId: 'p1', apiBase: API_BASE })
        expect(await handle.ready).toBe('ready')

        // A choice: the body carries the choiceId with LINE_1's callStack and root pair.
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-choice]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text))
        expect(stub).toHaveBeenCalledTimes(2)
        const [choiceUrl, choiceInit] = call(stub, 1)
        expect(choiceUrl).toBe('http://127.0.0.1:3358/api/v1/runtime/projects/p1/node/n1/next')
        expect(choiceInit.method).toBe('POST')
        expect(choiceInit.credentials).toBe('omit')
        expect(choiceInit.headers).toEqual({ 'Content-Type': 'application/json' })
        expect(JSON.parse(String(choiceInit.body))).toEqual({
            callStack: LINE_1.callStack,
            rootContainerId: 'scene-root',
            rootContainerType: 'scene',
            choiceId: 'c1'
        })

        // A line with no choices offers continue alone, and continue posts no choiceId.
        expect(shell(element).querySelectorAll('button')).toHaveLength(1)
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_3.text))
        expect(stub).toHaveBeenCalledTimes(3)
        const [continueUrl, continueInit] = call(stub, 2)
        expect(continueUrl).toBe('http://127.0.0.1:3358/api/v1/runtime/projects/p1/node/n2/next')
        expect(continueInit.credentials).toBe('omit')
        expect(JSON.parse(String(continueInit.body))).toEqual({
            callStack: LINE_2.callStack,
            rootContainerId: 'scene-root',
            rootContainerType: 'scene'
        })

        // The walk added no listener to the host, document or window, and unmount still empties the host.
        handle.unmount()
        expect(element.innerHTML).toBe('')
        for (const spy of listenerSpies) expect(spy).not.toHaveBeenCalled()
    })

    it('[a7] the authored ending shows its title, text and image', async () => {
        stubFetch(ok(LINE_2), ok(AUTHORED_ENDING))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())

        const ending = shell(element).querySelector('[data-taleswords-ending]')!
        expect(ending.getAttribute('data-taleswords-ending')).toBe('authored')
        expect(ending.querySelector('[data-taleswords-ending-title]')?.textContent).toBe('Home at Last')
        expect(ending.querySelector('[data-taleswords-ending-text]')?.textContent).toBe('Mira sleeps by the fire.')
        expect(ending.querySelector('img[data-taleswords-ending-image]')?.getAttribute('src')).toBe(
            'http://127.0.0.1:3358/uploads/ending.png'
        )
        expect(ending.querySelector('[data-taleswords-end-of-road]')).toBeNull()
        expect(ending.textContent).not.toContain('The story goes no further from here.')
    })

    /** An authored ending with nothing to show: the end-of-road view, its sentence and one restart, never a blank authored view. */
    async function expectEndOfRoadFallback(emptyAuthoredEnding: unknown): Promise<void> {
        stubFetch(ok(LINE_2), ok(emptyAuthoredEnding))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())

        const ending = shell(element).querySelector('[data-taleswords-ending]')!
        expect(ending.getAttribute('data-taleswords-ending')).toBe('end-of-road')
        expect(ending.childElementCount).toBeGreaterThan(0)
        expect(shell(element).querySelector('[data-taleswords-ending="authored"]')).toBeNull()
        expect(ending.querySelector('[data-taleswords-end-of-road]')?.textContent).toContain('The story goes no further from here.')
        expect(shell(element).querySelectorAll('button[data-taleswords-restart]')).toHaveLength(1)
    }

    it('[a7e] an authored ending with an empty payload falls back to the end-of-road view: ending {}', async () => {
        await expectEndOfRoadFallback({ ...AUTHORED_ENDING, ending: {} })
    })

    it("[a7e] an authored ending with an empty payload falls back to the end-of-road view: ending { title: '', text: '' }", async () => {
        await expectEndOfRoadFallback({ ...AUTHORED_ENDING, ending: { title: '', text: '' } })
    })

    it('[a7e] an authored ending with an empty payload falls back to the end-of-road view: no ending key', async () => {
        const withoutEnding: Record<string, unknown> = { ...AUTHORED_ENDING }
        delete withoutEnding.ending
        await expectEndOfRoadFallback(withoutEnding)
    })

    it('[a8] the end of the road offers restart alone, names nothing as unfinished, and restart re-reads the start', async () => {
        const stub = stubFetch(ok(LINE_2), ok(END_OF_ROAD), ok(LINE_1))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())

        const panel = shell(element).querySelector('[data-taleswords-ending]')!
        expect(panel.getAttribute('data-taleswords-ending')).toBe('end-of-road')
        expect(panel.textContent).toContain('The story goes no further from here.')
        for (const word of ['unfinished', 'broken', 'missing']) {
            expect(shell(element).textContent!.toLowerCase(), word).not.toContain(word)
        }
        const buttons = shell(element).querySelectorAll<HTMLButtonElement>('button')
        expect(buttons).toHaveLength(1)
        expect(buttons[0]!.hasAttribute('data-taleswords-restart')).toBe(true)

        buttons[0]!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_1.text))
        expect(stub).toHaveBeenCalledTimes(3)
        const [url, init] = call(stub, 2)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
        expect(init).not.toHaveProperty('headers')
        expect(shell(element).querySelector('[data-taleswords-ending]')).toBeNull()
    })

    it('[4] the ending view is chosen by reason, and an authored ending needs content to show', async () => {
        // A runtime stop carrying a nodeId: the old nodeId rule would call it authored.
        const stopWithNodeId = { ...END_OF_ROAD, nodeId: 'end-1', reason: 'dangling-edge' }
        stubFetch(ok(LINE_2), ok(stopWithNodeId))
        const stopped = host()

        expect(await player.mount(stopped, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(stopped).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(stopped).querySelector('[data-taleswords-ending]')).not.toBeNull())

        const panel = shell(stopped).querySelector('[data-taleswords-ending]')!
        expect(panel.getAttribute('data-taleswords-ending')).toBe('end-of-road')
        const buttons = shell(stopped).querySelectorAll<HTMLButtonElement>('button')
        expect(buttons).toHaveLength(1)
        expect(buttons[0]!.hasAttribute('data-taleswords-restart')).toBe(true)

        vi.unstubAllGlobals()
        document.body.innerHTML = ''

        stubFetch(ok(LINE_2), ok(AUTHORED_ENDING))
        const authored = host()

        expect(await player.mount(authored, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(authored).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(authored).querySelector('[data-taleswords-ending]')).not.toBeNull())

        expect(shell(authored).querySelector('[data-taleswords-ending]')!.getAttribute('data-taleswords-ending')).toBe('authored')
    })

    it('[a9] a 404 start settles the shell unavailable and renders nothing of a story', async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')

        expect(shell(element).getAttribute('data-state')).toBe('unavailable')
        expect(shell(element).querySelector('button, img, [data-taleswords-text]')).toBeNull()
    })
})

describe('the refusal when the story cannot be opened', () => {
    it('[r1] a 404 start shows the refusal text and nothing of a story', async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')

        expectRefusal(element)
    })

    it('[r2] an unknown and an unpublished project read the same refusal, which names no cause', async () => {
        // The product API answers both with the same 404: the player cannot tell them apart.
        stubFetch({ status: 404, body: NOT_FOUND_BODY }, { status: 404, body: NOT_FOUND_BODY })
        const unknown = host()
        const unpublished = host()

        expect(await player.mount(unknown, { projectId: 'no-such-project', apiBase: API_BASE }).ready).toBe('unavailable')
        expect(await player.mount(unpublished, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')

        expectRefusal(unknown)
        expectRefusal(unpublished)
        expect(unpublished.innerHTML).toBe(unknown.innerHTML)
        const text = shell(unknown).textContent!.toLowerCase()
        for (const word of ['unpublished', 'not found', 'does not exist', 'removed', 'deleted', 'broken', 'unfinished', 'missing']) {
            expect(text, word).not.toContain(word)
        }
    })

    it('[r3] a 404 carrying story_not_ready shows the not-ready view, not the refusal', async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY }, { status: 404, body: NO_MAIN_SCENE_BODY })
        const notFound = host()
        const noMainScene = host()

        expect(await player.mount(notFound, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')
        expect(await player.mount(noMainScene, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('not-ready')

        expectRefusal(notFound)
        expect(shell(noMainScene).getAttribute('data-state')).toBe('not-ready')
        expect(shell(noMainScene).querySelectorAll('[data-taleswords-refusal="not-ready"]')).toHaveLength(1)
        expect(shell(noMainScene).textContent).toBe('This story is not ready yet.')
        expect(shell(noMainScene).querySelector('button')).toBeNull()
        expect(shell(noMainScene).querySelector('[data-taleswords-refusal="unavailable"]')).toBeNull()
        expect(noMainScene.innerHTML).not.toBe(notFound.innerHTML)
        const text = shell(noMainScene).textContent!
        for (const leak of ['No main scene found', 'story_not_ready']) {
            expect(text, leak).not.toContain(leak)
        }
        for (const word of ['account', 'sign in', 'log in']) {
            expect(text.toLowerCase(), word).not.toContain(word)
        }
    })

    it('[r4] a 404 on next, or on an end-of-road restart, replaces the story with the refusal', async () => {
        stubFetch(ok(LINE_2), { status: 404, body: NOT_FOUND_BODY })
        const walking = host()

        expect(await player.mount(walking, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(walking).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(walking).getAttribute('data-state')).toBe('unavailable'))
        expectRefusal(walking)

        stubFetch(ok(LINE_2), ok(END_OF_ROAD), { status: 404, body: NOT_FOUND_BODY })
        const restarting = host()

        expect(await player.mount(restarting, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(restarting).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(restarting).querySelector('[data-taleswords-restart]')).not.toBeNull())
        shell(restarting).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
        await vi.waitFor(() => expect(shell(restarting).getAttribute('data-state')).toBe('unavailable'))
        expectRefusal(restarting)
    })

    it('[r5] a 500, a rejected fetch, a non-JSON body, or a 500 on next shows the legible error view, never the refusal', async () => {
        stubFetch({ status: 500, body: SERVER_ERROR_BODY })
        const serverError = host()
        expect(await player.mount(serverError, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('error')
        expectErrorView(serverError)

        // An empty queue: the stub rejects, as a network failure does.
        stubFetch()
        const rejected = host()
        expect(await player.mount(rejected, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('error')
        expectErrorView(rejected)

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
        )
        const nonJson = host()
        expect(await player.mount(nonJson, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('error')
        expectErrorView(nonJson)

        stubFetch(ok(LINE_2), { status: 500, body: SERVER_ERROR_BODY })
        const midWalk = host()
        expect(await player.mount(midWalk, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(midWalk).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(midWalk).getAttribute('data-state')).toBe('error'))
        expectErrorView(midWalk)
    })

    it('[r6] no server message, error name or stack reaches the page on a 404 or a 500', async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY }, { status: 500, body: SERVER_ERROR_BODY })
        const notFound = host()
        const serverError = host()

        expect(await player.mount(notFound, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')
        expect(await player.mount(serverError, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('error')

        for (const element of [notFound, serverError]) {
            const text = shell(element).textContent!
            for (const leak of ['Project not found', 'something went wrong', 'Error', 'at ']) {
                expect(text, leak).not.toContain(leak)
            }
        }
    })

    it('[r7] copy.unavailable replaces the refusal words', async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE, copy: { unavailable: 'X' } }).ready).toBe(
            'unavailable'
        )

        expectRefusal(element, 'X')
        expect(shell(element).textContent).not.toContain(REFUSAL_TEXT)
    })

    it('[r8] a 502 on next shows the error view, and Start again re-reads the start and walks again', async () => {
        // The third answer is queued for the restart, which is the third read.
        const stub = stubFetch(ok(LINE_2), { status: 502, body: '<html>Bad Gateway</html>' }, ok(LINE_2))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('error'))
        expectErrorView(element)
        expect(stub).toHaveBeenCalledTimes(2)

        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('ready'))
        expect(stub).toHaveBeenCalledTimes(3)
        const [url, init] = call(stub, 2)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
        expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text)
        expect(shell(element).querySelector('[data-taleswords-refusal]')).toBeNull()
    })

    it('[r9] a 502 on an end-of-road restart shows the error view: the restart control survives a failed restart', async () => {
        stubFetch(ok(LINE_2), ok(END_OF_ROAD), { status: 502, body: '<html>Bad Gateway</html>' })
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-restart]')).not.toBeNull())
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('error'))
        expectErrorView(element)
    })

    it('[r10] copy.error replaces the error sentence', async () => {
        stubFetch({ status: 500, body: SERVER_ERROR_BODY })
        const element = host()

        expect(
            await player.mount(element, { projectId: 'p1', apiBase: API_BASE, copy: { error: 'Try this story again later.' } }).ready
        ).toBe('error')

        expectErrorView(element, 'Try this story again later.')
        expect(shell(element).textContent).not.toContain('The story could not be loaded.')
    })

    it('[r11] a 404 without the story_not_ready code stays the plain refusal', async () => {
        stubFetch(
            { status: 404, body: NOT_FOUND_BODY },
            { status: 404, body: { errors: [{ message: 'No main scene found' }] } },
            { status: 404, body: { errors: [{ message: 'x', code: 'other' }] } }
        )
        const unknown = host()
        const noCode = host()
        const otherCode = host()

        expect(await player.mount(unknown, { projectId: 'no-such-project', apiBase: API_BASE }).ready).toBe('unavailable')
        expect(await player.mount(noCode, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')
        expect(await player.mount(otherCode, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')

        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Not Found</html>', { status: 404 })))
        const nonJson = host()
        expect(await player.mount(nonJson, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('unavailable')

        expectRefusal(unknown)
        for (const element of [noCode, otherCode, nonJson]) {
            expectRefusal(element)
            expect(element.innerHTML).toBe(unknown.innerHTML)
        }
    })

    it('[r12] copy.notReady overrides the not-ready text', async () => {
        stubFetch({ status: 404, body: NO_MAIN_SCENE_BODY })
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE, copy: { notReady: 'Coming soon.' } }).ready).toBe(
            'not-ready'
        )

        expect(shell(element).querySelector('[data-taleswords-not-ready]')?.textContent).toBe('Coming soon.')
    })
})

describe('the dead end when every choice on a line is unavailable', () => {
    const DEAD_END_LINE = { ...LINE_1, choices: LINE_1.choices.map(choice => ({ ...choice, isUnavailable: true })) }

    it('[d1] shows the notice and one enabled Start again under the disabled choices, and the shell reads dead-end', async () => {
        stubFetch(ok(DEAD_END_LINE))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')

        expect(shell(element).getAttribute('data-state')).toBe('dead-end')
        const notices = shell(element).querySelectorAll('[data-taleswords-notice="dead-end"]')
        expect(notices).toHaveLength(1)
        expect(notices[0]!.textContent).toBe('The story cannot continue from here.')
        const restarts = shell(element).querySelectorAll<HTMLButtonElement>('button[data-taleswords-restart]')
        expect(restarts).toHaveLength(1)
        expect(restarts[0]!.disabled).toBe(false)
        expect(restarts[0]!.textContent).toBe('Start again')
        const choices = [...shell(element).querySelectorAll<HTMLButtonElement>('button[data-taleswords-choice]')]
        expect(choices).toHaveLength(3)
        expect(choices.map(choice => choice.disabled)).toEqual([true, true, true])
        expect(shell(element).querySelector('[data-taleswords-continue]')).toBeNull()
    })

    it('[d2] copy.deadEnd replaces the notice', async () => {
        stubFetch(ok(DEAD_END_LINE))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE, copy: { deadEnd: 'Nothing more here.' } }).ready).toBe(
            'ready'
        )

        expect(shell(element).querySelector('[data-taleswords-notice="dead-end"]')?.textContent).toBe('Nothing more here.')
    })

    it('[d3] a click on a disabled choice fetches nothing, and Start again re-reads the start', async () => {
        const stub = stubFetch(ok(DEAD_END_LINE), ok(LINE_1))
        const element = host()

        expect(await player.mount(element, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')

        const choice = shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-choice]')!
        choice.click()
        // A click event dispatched straight at the control, past the disabled attribute.
        choice.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise(resolveTick => setTimeout(resolveTick, 0))
        expect(stub).toHaveBeenCalledTimes(1)

        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('ready'))
        expect(stub).toHaveBeenCalledTimes(2)
        const [url, init] = call(stub, 1)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
    })

    it('[d4] an end of the road and a line with one unavailable choice still read ready, with no dead-end notice', async () => {
        stubFetch(ok(END_OF_ROAD))
        const ending = host()

        expect(await player.mount(ending, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        expect(shell(ending).querySelector('[data-taleswords-ending]')).not.toBeNull()
        expect(shell(ending).getAttribute('data-state')).toBe('ready')
        expect(shell(ending).querySelector('[data-taleswords-notice="dead-end"]')).toBeNull()

        vi.unstubAllGlobals()
        document.body.innerHTML = ''

        stubFetch(ok(LINE_1))
        const line = host()

        expect(await player.mount(line, { projectId: 'p1', apiBase: API_BASE }).ready).toBe('ready')
        expect(shell(line).getAttribute('data-state')).toBe('ready')
        expect(shell(line).querySelector('[data-taleswords-notice]')).toBeNull()
        expect(shell(line).querySelector('[data-taleswords-restart]')).toBeNull()
    })
})

describe('host onState', () => {
    // The closed set of values the host may hear, and what must never travel with them (the leak list of [r6], widened).
    const HOST_STATES = ['ready', 'unavailable', 'not-ready', 'ended', 'error']
    const LEAKS = ['Project not found', 'No main scene found', 'story_not_ready', 'something went wrong', 'Error', 'at ', 'http', '/', 'p1']

    /** Every argument onState is ever called with, in order: one call with one argument adds one item. */
    function listen(): { heard: unknown[]; onState: (...args: unknown[]) => void } {
        const heard: unknown[] = []
        return { heard, onState: (...args: unknown[]) => void heard.push(...args) }
    }

    /** The host heard exactly this sequence, and every item is a bare state name of the closed set. */
    function expectHeard(heard: unknown[], expected: string[]): void {
        expect(heard).toEqual(expected)
        for (const item of heard) {
            expect(typeof item).toBe('string')
            expect(HOST_STATES).toContain(item)
        }
    }

    function expectNoLeak(heard: unknown[]): void {
        const payload = JSON.stringify(heard)
        for (const leak of LEAKS) expect(payload, leak).not.toContain(leak)
    }

    it('[h1] the opened state is heard once, after data-state is written and before ready settles', async () => {
        stubFetch(ok(LINE_1))
        const element = host()
        const { heard, onState } = listen()
        const seen: [string | null, boolean][] = []
        let readySettled = false

        const handle = player.mount(element, {
            projectId: 'p1',
            apiBase: API_BASE,
            onState: (...args: unknown[]) => {
                seen.push([shell(element).getAttribute('data-state'), readySettled])
                onState(...args)
            }
        })
        void handle.ready.then(() => {
            readySettled = true
        })

        expect(await handle.ready).toBe('ready')
        expectHeard(heard, ['ready'])
        expect(seen).toEqual([['ready', false]])
        expect(shell(element).getAttribute('data-state')).toBe('ready')
    })

    it('[h2] a refused start is heard as unavailable, and a story_not_ready start as not-ready, naming no cause', async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const notFound = host()
        const unavailable = listen()
        expect(await player.mount(notFound, { projectId: 'p1', apiBase: API_BASE, onState: unavailable.onState }).ready).toBe(
            'unavailable'
        )
        expectHeard(unavailable.heard, ['unavailable'])
        expectNoLeak(unavailable.heard)
        expectRefusal(notFound)

        vi.unstubAllGlobals()
        document.body.innerHTML = ''

        stubFetch({ status: 404, body: NO_MAIN_SCENE_BODY })
        const noMainScene = host()
        const notReady = listen()
        expect(await player.mount(noMainScene, { projectId: 'p1', apiBase: API_BASE, onState: notReady.onState }).ready).toBe(
            'not-ready'
        )
        expectHeard(notReady.heard, ['not-ready'])
        expectNoLeak(notReady.heard)
        expect(shell(noMainScene).getAttribute('data-state')).toBe('not-ready')
    })

    it('[h3] an authored ending and the end of the road are each heard as ended after ready, ready and data-state unchanged', async () => {
        for (const [body, view] of [
            [AUTHORED_ENDING, 'authored'],
            [END_OF_ROAD, 'end-of-road']
        ] as const) {
            stubFetch(ok(LINE_2), ok(body))
            const element = host()
            const { heard, onState } = listen()

            const handle = player.mount(element, { projectId: 'p1', apiBase: API_BASE, onState })
            expect(await handle.ready).toBe('ready')
            expectHeard(heard, ['ready'])
            shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
            await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())

            expectHeard(heard, ['ready', 'ended'])
            expect(await handle.ready, view).toBe('ready')
            expect(shell(element).getAttribute('data-state'), view).toBe('ready')
            expect(shell(element).querySelector('[data-taleswords-ending]')!.getAttribute('data-taleswords-ending')).toBe(view)

            vi.unstubAllGlobals()
            document.body.innerHTML = ''
        }
    })

    it('[h4] a 500 start, a rejected fetch and a 200 non-JSON body are each heard as error, naming no cause', async () => {
        stubFetch({ status: 500, body: SERVER_ERROR_BODY })
        const serverError = host()
        const fromServer = listen()
        expect(await player.mount(serverError, { projectId: 'p1', apiBase: API_BASE, onState: fromServer.onState }).ready).toBe('error')
        expectErrorView(serverError)

        // An empty queue: the stub rejects, as a network failure does.
        stubFetch()
        const rejected = host()
        const fromRejection = listen()
        expect(await player.mount(rejected, { projectId: 'p1', apiBase: API_BASE, onState: fromRejection.onState }).ready).toBe('error')
        expectErrorView(rejected)

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
        )
        const nonJson = host()
        const fromNonJson = listen()
        expect(await player.mount(nonJson, { projectId: 'p1', apiBase: API_BASE, onState: fromNonJson.onState }).ready).toBe('error')
        expectErrorView(nonJson)

        for (const { heard } of [fromServer, fromRejection, fromNonJson]) {
            expectHeard(heard, ['error'])
            expectNoLeak(heard)
        }
    })

    it('[h5] a 500 on next mid-walk is heard as error when data-state turns error, ready staying ready', async () => {
        stubFetch(ok(LINE_2), { status: 500, body: SERVER_ERROR_BODY })
        const element = host()
        const { heard, onState } = listen()
        const dataStates: (string | null)[] = []

        const handle = player.mount(element, {
            projectId: 'p1',
            apiBase: API_BASE,
            onState: (...args: unknown[]) => {
                dataStates.push(shell(element).getAttribute('data-state'))
                onState(...args)
            }
        })
        expect(await handle.ready).toBe('ready')
        expectHeard(heard, ['ready'])

        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('error'))

        expectHeard(heard, ['ready', 'error'])
        expectNoLeak(heard)
        expect(dataStates).toEqual(['ready', 'error'])
        expect(await handle.ready).toBe('ready')
        expectErrorView(element)
    })

    it('[h6] a 404 on next mid-walk is heard as unavailable, never not-ready', async () => {
        for (const body of [NOT_FOUND_BODY, NO_MAIN_SCENE_BODY]) {
            stubFetch(ok(LINE_2), { status: 404, body })
            const element = host()
            const { heard, onState } = listen()

            const handle = player.mount(element, { projectId: 'p1', apiBase: API_BASE, onState })
            expect(await handle.ready).toBe('ready')
            shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
            await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('unavailable'))

            expectHeard(heard, ['ready', 'unavailable'])
            expect(await handle.ready).toBe('ready')
            expectRefusal(element)

            vi.unstubAllGlobals()
            document.body.innerHTML = ''
        }
    })

    it('[h7] a 502 on an end-of-road restart is heard as error, and a good restart after it as ready again', async () => {
        stubFetch(ok(LINE_2), ok(END_OF_ROAD), { status: 502, body: '<html>Bad Gateway</html>' }, ok(LINE_2))
        const element = host()
        const { heard, onState } = listen()

        const handle = player.mount(element, { projectId: 'p1', apiBase: API_BASE, onState })
        expect(await handle.ready).toBe('ready')
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-restart]')).not.toBeNull())
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('error'))
        expectErrorView(element)
        expectHeard(heard, ['ready', 'ended', 'error'])

        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
        await vi.waitFor(() => expect(shell(element).getAttribute('data-state')).toBe('ready'))
        expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text)

        expectHeard(heard, ['ready', 'ended', 'error', 'ready'])
        expect(await handle.ready).toBe('ready')
    })

    it('[h8] an unmount while the start read is pending is heard as nothing, and its late answer as nothing', async () => {
        let answer: (response: Response) => void = () => {}
        vi.stubGlobal(
            'fetch',
            vi.fn(
                () =>
                    new Promise<Response>(resolveAnswer => {
                        answer = resolveAnswer
                    })
            )
        )
        const element = host()
        const { heard, onState } = listen()

        const handle = player.mount(element, { projectId: 'p1', apiBase: API_BASE, onState })
        expect(shell(element).getAttribute('data-state')).toBe('loading')
        handle.unmount()
        expect(await handle.ready).toBe('error')

        answer(new Response(JSON.stringify(LINE_1), { status: 200 }))
        await new Promise(resolveTick => setTimeout(resolveTick, 0))

        expectHeard(heard, [])
        expect(element.innerHTML).toBe('')
    })

    it('[h9] the README documents onState among the mount options, its closed values and its state-name-only payload', () => {
        const readme = readFileSync(join(root, 'README.md'), 'utf8')
        const lines = readme.split('\n')

        expect(lines).toContain('## Mount options')
        expect(lines).toContain('### `onState`')
        expect(readme.indexOf('## What is here today')).toBeLessThan(readme.indexOf('## Mount options'))
        expect(readme.indexOf('## Mount options')).toBeLessThan(readme.indexOf('### `onState`'))
        expect(readme.indexOf('### `onState`')).toBeLessThan(readme.indexOf('## Development'))

        // The closed set: exactly these values, each with its meaning.
        const valueRows = lines.filter(line => /^\| `'[a-z-]+'` \|/.test(line))
        expect(valueRows.map(line => /^\| `'([a-z-]+)'` \|/.exec(line)![1])).toEqual(HOST_STATES)
        expect(readme).toContain("| `'ready'` | opened:")
        expect(readme).toContain("| `'unavailable'` | refused:")
        expect(readme).toContain("| `'not-ready'` | refused:")
        expect(readme).toContain("| `'ended'` | ended:")
        expect(readme).toContain("| `'error'` | failed:")

        expect(readme).toContain('The payload names the state only')

        const browserRow = lines.find(line => line.startsWith('| `@taleswords/player/browser` |'))
        expect(browserRow).toBeDefined()
        expect(browserRow).not.toContain('(coming)')
    })
})
