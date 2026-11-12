// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import { TaleswordsPlayer, type PlayerCopy } from '../src/components.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The reader's walk as a Vue 3 site gets it: TaleswordsPlayer, imported from src, rendered by
// createApp into a host div under happy-dom, with fetch stubbed by contract-complete runtime
// states. The fixtures and stubFetch are copied from traversal.test.ts, which keeps its own.
// The wrapper hands no PlayerHandle to the site, so every wait is on the shell's data-state.

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

const REFUSAL_TEXT = 'This story is not available.'

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

/** The apps still mounted, unmounted after each test. */
const apps: App[] = []

/** A Vue 3 site rendering the wrapper into the host, as a site would. */
function mountWrapper(element: Element, props: { projectId: string; apiBase: string; copy?: Partial<PlayerCopy> }): App {
    const app = createApp({ render: () => h(TaleswordsPlayer, props) })
    app.mount(element)
    apps.push(app)
    return app
}

function unmountWrapper(app: App): void {
    apps.splice(apps.indexOf(app), 1)
    app.unmount()
}

async function settled(element: Element, state: string): Promise<void> {
    await vi.waitFor(() => expect(shell(element)?.getAttribute('data-state')).toBe(state))
}

/** The host holds the wrapper's one div, the div holds the shell, and the shell the refusal alone. */
function expectRefusal(element: Element, text = REFUSAL_TEXT): void {
    expect(element.children).toHaveLength(1)
    expect(element.children[0]!.children).toHaveLength(1)
    expect(shell(element).getAttribute('data-state')).toBe('unavailable')
    expect(shell(element).children).toHaveLength(1)
    const refusal = shell(element).querySelector('[data-taleswords-refusal="unavailable"]')
    expect(refusal).not.toBeNull()
    expect(refusal!.querySelector('[data-taleswords-unavailable]')?.textContent).toBe(text)
    expect(shell(element).textContent).toBe(text)
    expect(shell(element).querySelector('button, img, [data-taleswords-text]')).toBeNull()
}

afterEach(() => {
    for (const app of apps.splice(0)) app.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe("the reader's walk through the Vue 3 TaleswordsPlayer", () => {
    it('[w1] opens the story with one anonymous GET of the start, credentials omitted, and the shell settles ready', async () => {
        const stub = stubFetch(ok(LINE_1))
        const element = host()

        mountWrapper(element, { projectId: 'p1', apiBase: API_BASE })

        await settled(element, 'ready')
        expect(stub).toHaveBeenCalledTimes(1)
        const [url, init] = call(stub, 0)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
        expect(init).not.toHaveProperty('headers')
        expect(init).not.toHaveProperty('body')
    })

    it("[w2] shows the line's text as text, the scene image and the portrait, src resolved against apiBase", async () => {
        stubFetch(ok(LINE_1))
        const element = host()

        mountWrapper(element, { projectId: 'p1', apiBase: API_BASE })
        await settled(element, 'ready')

        const text = shell(element).querySelector('[data-taleswords-text]')
        expect(text).not.toBeNull()
        expect(text!.textContent).toBe('The gate is <b>shut</b>.')
        expect(text!.querySelector('b')).toBeNull()

        const scene = shell(element).querySelectorAll<HTMLImageElement>('img[data-taleswords-scene]')
        expect(scene).toHaveLength(1)
        expect(scene[0]!.getAttribute('src')).toBe('http://127.0.0.1:3358/uploads/scene-1.png')

        const portrait = shell(element).querySelectorAll<HTMLImageElement>('img[data-taleswords-portrait]')
        expect(portrait).toHaveLength(1)
        expect(portrait[0]!.getAttribute('alt')).toBe('Mira')
        expect(portrait[0]!.getAttribute('src')).toBe('http://127.0.0.1:3358/uploads/mira.png')
    })

    it('[w3] a choice and a continue each POST next echoing callStack and the root pair, choiceId only on the choice; a disabled choice fetches nothing', async () => {
        const stub = stubFetch(ok(LINE_1), ok(LINE_2), ok(LINE_3))
        const element = host()

        mountWrapper(element, { projectId: 'p1', apiBase: API_BASE })
        await settled(element, 'ready')

        const choices = [...shell(element).querySelectorAll<HTMLButtonElement>('button[data-taleswords-choice]')]
        expect(choices.map(choice => choice.textContent)).toEqual(['Knock', 'Climb the wall', 'Walk away'])
        expect(choices.map(choice => choice.disabled)).toEqual([false, true, false])

        // The unavailable choice: a click, and a click event dispatched past the disabled attribute.
        choices[1]!.click()
        choices[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise(resolveTick => setTimeout(resolveTick, 0))
        expect(stub).toHaveBeenCalledTimes(1)
        expect(shell(element).querySelector('[data-taleswords-text]')!.textContent).toBe(LINE_1.text)

        // A choice: the body carries the choiceId with LINE_1's callStack and root pair.
        choices[0]!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text))
        expect(stub).toHaveBeenCalledTimes(2)
        const [choiceUrl, choiceInit] = call(stub, 1)
        expect(choiceUrl).toBe('http://127.0.0.1:3358/api/v1/runtime/projects/p1/node/n1/next')
        expect(choiceInit.method).toBe('POST')
        expect(choiceInit.credentials).toBe('omit')
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
        expect(continueInit.method).toBe('POST')
        expect(continueInit.credentials).toBe('omit')
        expect(JSON.parse(String(continueInit.body))).toEqual({
            callStack: LINE_2.callStack,
            rootContainerId: 'scene-root',
            rootContainerType: 'scene'
        })
    })

    it('[w4] an authored ending shows its title, text and image; the end of the road offers one restart, which GETs the start again', async () => {
        stubFetch(ok(LINE_2), ok(AUTHORED_ENDING))
        const authored = host()

        mountWrapper(authored, { projectId: 'p1', apiBase: API_BASE })
        await settled(authored, 'ready')
        shell(authored).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(authored).querySelector('[data-taleswords-ending]')).not.toBeNull())

        const ending = shell(authored).querySelector('[data-taleswords-ending]')!
        expect(ending.getAttribute('data-taleswords-ending')).toBe('authored')
        expect(ending.querySelector('[data-taleswords-ending-title]')?.textContent).toBe('Home at Last')
        expect(ending.querySelector('[data-taleswords-ending-text]')?.textContent).toBe('Mira sleeps by the fire.')
        expect(ending.querySelector('img[data-taleswords-ending-image]')?.getAttribute('src')).toBe(
            'http://127.0.0.1:3358/uploads/ending.png'
        )

        const stub = stubFetch(ok(LINE_2), ok(END_OF_ROAD), ok(LINE_1))
        const road = host()

        mountWrapper(road, { projectId: 'p1', apiBase: API_BASE })
        await settled(road, 'ready')
        shell(road).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
        await vi.waitFor(() => expect(shell(road).querySelector('[data-taleswords-ending]')).not.toBeNull())

        const panel = shell(road).querySelector('[data-taleswords-ending]')!
        expect(panel.getAttribute('data-taleswords-ending')).toBe('end-of-road')
        expect(panel.textContent).toContain('The story goes no further from here.')
        const buttons = shell(road).querySelectorAll<HTMLButtonElement>('button')
        expect(buttons).toHaveLength(1)
        expect(buttons[0]!.hasAttribute('data-taleswords-restart')).toBe(true)

        buttons[0]!.click()
        await vi.waitFor(() => expect(shell(road).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_1.text))
        expect(stub).toHaveBeenCalledTimes(3)
        const [url, init] = call(stub, 2)
        expect(url).toBe(START_URL)
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
        expect(init).not.toHaveProperty('headers')
        expect(shell(road).querySelector('[data-taleswords-ending]')).toBeNull()
    })

    it("[w5] a 404 start shows only the refusal, and copy.unavailable replaces its words", async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const element = host()

        mountWrapper(element, { projectId: 'p1', apiBase: API_BASE })
        await settled(element, 'unavailable')
        expectRefusal(element)

        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const copied = host()

        mountWrapper(copied, { projectId: 'p1', apiBase: API_BASE, copy: { unavailable: 'X' } })
        await settled(copied, 'unavailable')
        expectRefusal(copied, 'X')
        expect(shell(copied).textContent).not.toContain(REFUSAL_TEXT)
    })

    it('[w6] app.unmount empties the host, aborts a pending start read through its signal, and adds no listener', async () => {
        const element = host()
        const listenerSpies = [
            vi.spyOn(element, 'addEventListener'),
            vi.spyOn(document, 'addEventListener'),
            vi.spyOn(window, 'addEventListener')
        ]

        // (1) unmount after the read has settled
        stubFetch(ok(LINE_1))
        const settledApp = mountWrapper(element, { projectId: 'p1', apiBase: API_BASE })
        await settled(element, 'ready')
        unmountWrapper(settledApp)
        expect(element.children).toHaveLength(0)
        expect(element.innerHTML).toBe('')

        // (2) unmount while the start read is pending
        let answer: (response: Response) => void = () => {}
        let signal: AbortSignal | undefined
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: string, init: RequestInit) => {
                signal = init.signal ?? undefined
                return new Promise<Response>(resolveAnswer => {
                    answer = resolveAnswer
                })
            })
        )
        const pendingApp = mountWrapper(element, { projectId: 'p1', apiBase: API_BASE })
        expect(shell(element).getAttribute('data-state')).toBe('loading')
        expect(signal?.aborted).toBe(false)
        unmountWrapper(pendingApp)
        expect(signal?.aborted).toBe(true)
        expect(element.children).toHaveLength(0)
        expect(element.innerHTML).toBe('')
        answer(new Response(JSON.stringify(LINE_1), { status: 200 }))
        await new Promise(resolveTick => setTimeout(resolveTick, 0))
        expect(element.innerHTML).toBe('')

        for (const spy of listenerSpies) expect(spy).not.toHaveBeenCalled()
    })

    it('[rA] a page re-render with an equal inline copy keeps the reader on the line they reached', async () => {
        const stub = stubFetch(ok(LINE_1), ok(LINE_2), ok(LINE_1))
        const element = host()
        const counter = ref(0)

        // The copy literal is built anew on every render, as an author's inline prop is.
        const app = createApp({
            render: () =>
                h('section', [
                    h('span', String(counter.value)),
                    h(TaleswordsPlayer, { projectId: 'p1', apiBase: API_BASE, copy: { continue: 'Go on' } })
                ])
        })
        app.mount(element)
        apps.push(app)
        await settled(element, 'ready')

        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-choice]')!.click()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text))

        counter.value++
        await nextTick()
        await new Promise(resolveTick => setTimeout(resolveTick, 0))
        expect(element.querySelector('span')?.textContent).toBe('1')
        expect(stub.mock.calls.filter(([url]) => url === START_URL)).toHaveLength(1)
        expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text)
    })

    it('[rB] one wording changed in place on a reactive copy is applied, and the story starts over', async () => {
        const stub = stubFetch({ status: 404, body: NOT_FOUND_BODY }, { status: 404, body: NOT_FOUND_BODY })
        const element = host()
        const copy = reactive<Partial<PlayerCopy>>({ unavailable: 'X' })

        const app = createApp({ render: () => h(TaleswordsPlayer, { projectId: 'p1', apiBase: API_BASE, copy }) })
        app.mount(element)
        apps.push(app)
        await settled(element, 'unavailable')
        expectRefusal(element, 'X')

        copy.unavailable = 'Y'
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-unavailable]')?.textContent).toBe('Y'))
        expectRefusal(element, 'Y')
        expect(stub.mock.calls.filter(([url]) => url === START_URL)).toHaveLength(2)
    })

    it('[rC] a changed projectId mounts the player again for the new story', async () => {
        const stub = stubFetch(ok(LINE_1), ok(LINE_2))
        const element = host()
        const projectId = ref('p1')

        const app = createApp({ render: () => h(TaleswordsPlayer, { projectId: projectId.value, apiBase: API_BASE }) })
        app.mount(element)
        apps.push(app)
        await settled(element, 'ready')
        expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_1.text)

        projectId.value = 'p2'
        await nextTick()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text))
        expect(stub).toHaveBeenCalledTimes(2)
        expect(call(stub, 0)[0]).toBe(START_URL)
        const [url, init] = call(stub, 1)
        expect(url).toBe(START_URL.replace('/projects/p1/', '/projects/p2/'))
        expect(init.method ?? 'GET').toBe('GET')
        expect(init.credentials).toBe('omit')
    })
})

describe('host state event', () => {
    // The closed set a Vue site may hear, and what must never travel with it (the leak list of traversal's host onState).
    const HOST_STATES = ['ready', 'unavailable', 'not-ready', 'ended', 'error']
    const LEAKS = ['Project not found', 'No main scene found', 'story_not_ready', 'something went wrong', 'Error', 'at ', 'http', '/', 'p1']
    const NO_MAIN_SCENE_BODY = { errors: [{ message: 'No main scene found', code: 'story_not_ready' }] }
    const SERVER_ERROR_BODY = { errors: [{ message: 'something went wrong ' }] }

    type Listener = {
        heard: unknown[]
        arities: number[]
        dataStates: (string | null)[]
        onState: (...args: unknown[]) => void
    }

    /**
     * The site's 'state' listener. Every argument it is called with lands in heard, so one call with one
     * argument adds one item; arities keeps each call's argument count, dataStates the shell's data-state then.
     */
    function listen(element?: Element): Listener {
        const heard: unknown[] = []
        const arities: number[] = []
        const dataStates: (string | null)[] = []
        const onState = (...args: unknown[]): void => {
            arities.push(args.length)
            dataStates.push(element ? (shell(element)?.getAttribute('data-state') ?? null) : null)
            heard.push(...args)
        }
        return { heard, arities, dataStates, onState }
    }

    /** The site heard exactly this sequence, one bare state name of the closed set per call. */
    function expectHeard(listener: Listener, expected: string[]): void {
        expect(listener.heard).toEqual(expected)
        expect(listener.arities).toEqual(expected.map(() => 1))
        for (const item of listener.heard) {
            expect(typeof item).toBe('string')
            expect(HOST_STATES).toContain(item)
        }
    }

    function expectNoLeak(listener: Listener): void {
        const payload = JSON.stringify(listener.heard)
        for (const leak of LEAKS) expect(payload, leak).not.toContain(leak)
    }

    /** A Vue 3 site rendering the wrapper with its 'state' listener passed as onState in h(), as @state compiles. */
    function mountHeard(
        element: Element,
        props: { projectId: string; apiBase: string; copy?: Partial<PlayerCopy> },
        onState: (...args: unknown[]) => void
    ): App {
        const app = createApp({ render: () => h(TaleswordsPlayer, { ...props, onState }) })
        app.mount(element)
        apps.push(app)
        return app
    }

    function tick(): Promise<void> {
        return new Promise(resolveTick => setTimeout(resolveTick, 0))
    }

    /** A fetch whose first call stays pending until answerFirst; every later call takes the next queued answer. */
    function deferFirstFetch(...answers: Answer[]) {
        const queue = [...answers]
        let calls = 0
        let answer: (response: Response) => void = () => {}
        const stub = vi.fn((_url: string, _init: RequestInit): Promise<Response> => {
            calls++
            if (calls === 1) {
                return new Promise<Response>(resolveAnswer => {
                    answer = resolveAnswer
                })
            }
            const next = queue.shift()
            if (!next) return Promise.reject(new Error('no answer queued for this request'))
            return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }))
        })
        vi.stubGlobal('fetch', stub)
        return {
            stub,
            answerFirst(late: Answer): void {
                answer(new Response(JSON.stringify(late.body), { status: late.status }))
            }
        }
    }

    function clickContinue(element: Element): void {
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-continue]')!.click()
    }

    function clickRestart(element: Element): void {
        shell(element).querySelector<HTMLButtonElement>('button[data-taleswords-restart]')!.click()
    }

    it("[s1] a start that answers a line is heard once, as the bare string 'ready', no later than data-state settles ready", async () => {
        stubFetch(ok(LINE_1))
        const element = host()
        const listener = listen(element)

        mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
        expect(listener.heard).toEqual([])

        await settled(element, 'ready')
        // Heard at the latest in the same turn data-state was written: browser.ts writes it, then emits.
        expectHeard(listener, ['ready'])
        expect(listener.dataStates).toEqual(['ready'])

        await tick()
        expectHeard(listener, ['ready'])
    })

    it("[s2] a 404 start is heard as exactly ['unavailable']", async () => {
        stubFetch({ status: 404, body: NOT_FOUND_BODY })
        const element = host()
        const listener = listen(element)

        mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
        await settled(element, 'unavailable')
        await tick()

        expectHeard(listener, ['unavailable'])
        expectNoLeak(listener)
        expectRefusal(element)
    })

    it("[s3] a not-ready start (a published story with no main scene) is heard as exactly ['not-ready']", async () => {
        stubFetch({ status: 404, body: NO_MAIN_SCENE_BODY })
        const element = host()
        const listener = listen(element)

        mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
        await settled(element, 'not-ready')
        await tick()

        expectHeard(listener, ['not-ready'])
        expectNoLeak(listener)
        expect(shell(element).querySelector('[data-taleswords-refusal="not-ready"]')).not.toBeNull()
    })

    it("[s4] an authored ending and the end of the road are each heard as ['ready', 'ended'], data-state staying ready", async () => {
        for (const [body, view] of [
            [AUTHORED_ENDING, 'authored'],
            [END_OF_ROAD, 'end-of-road']
        ] as const) {
            stubFetch(ok(LINE_2), ok(body))
            const element = host()
            const listener = listen(element)

            mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
            await settled(element, 'ready')
            expectHeard(listener, ['ready'])

            clickContinue(element)
            await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())
            await tick()

            expectHeard(listener, ['ready', 'ended'])
            expect(listener.dataStates, view).toEqual(['ready', 'ready'])
            expect(shell(element).getAttribute('data-state'), view).toBe('ready')
            expect(shell(element).querySelector('[data-taleswords-ending]')!.getAttribute('data-taleswords-ending')).toBe(view)

            vi.unstubAllGlobals()
        }
    })

    it("[s5] a mid-walk failure (a 500 on next, or a body the read rejects) is heard as ['ready', 'error'] with the error view and Start again", async () => {
        for (const [failure, label] of [
            [{ status: 500, body: SERVER_ERROR_BODY }, '500'],
            [ok({ type: 'scene', text: 'not a runtime state' }), 'rejected body']
        ] as const) {
            stubFetch(ok(LINE_2), failure)
            const element = host()
            const listener = listen(element)

            mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
            await settled(element, 'ready')
            expectHeard(listener, ['ready'])

            clickContinue(element)
            await settled(element, 'error')
            await tick()

            expectHeard(listener, ['ready', 'error'])
            expectNoLeak(listener)
            expect(listener.dataStates, label).toEqual(['ready', 'error'])
            const view = shell(element).querySelector('[data-taleswords-refusal="error"]')
            expect(view, label).not.toBeNull()
            expect(view!.querySelector('[data-taleswords-error]')?.textContent).toBe('The story could not be loaded.')
            const restart = view!.querySelectorAll<HTMLButtonElement>('button')
            expect(restart).toHaveLength(1)
            expect(restart[0]!.hasAttribute('data-taleswords-restart')).toBe(true)
            expect(restart[0]!.textContent).toBe('Start again')

            vi.unstubAllGlobals()
        }
    })

    it("[s6] a mid-walk 404 is heard as ['ready', 'unavailable'], never 'not-ready' mid-walk", async () => {
        for (const body of [NOT_FOUND_BODY, NO_MAIN_SCENE_BODY]) {
            stubFetch(ok(LINE_2), { status: 404, body })
            const element = host()
            const listener = listen(element)

            mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
            await settled(element, 'ready')
            clickContinue(element)
            await settled(element, 'unavailable')
            await tick()

            expectHeard(listener, ['ready', 'unavailable'])
            expect(listener.heard).not.toContain('not-ready')
            expectNoLeak(listener)
            expectRefusal(element)

            vi.unstubAllGlobals()
        }
    })

    it("[s7] a restart after the end of the road that answers a line is heard as one more 'ready'", async () => {
        const stub = stubFetch(ok(LINE_2), ok(END_OF_ROAD), ok(LINE_1))
        const element = host()
        const listener = listen(element)

        mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
        await settled(element, 'ready')
        clickContinue(element)
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-restart]')).not.toBeNull())
        expectHeard(listener, ['ready', 'ended'])

        clickRestart(element)
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_1.text))
        await tick()

        expectHeard(listener, ['ready', 'ended', 'ready'])
        expect(stub).toHaveBeenCalledTimes(3)
        expect(call(stub, 2)[0]).toBe(START_URL)
    })

    it("[s8] a remount on a prop change while the old read is pending is heard for the new mount only; the old late answer is never heard", async () => {
        // (1) projectId changed, as in [rC]
        const byProject = deferFirstFetch(ok(LINE_2))
        const element = host()
        const listener = listen(element)
        const projectId = ref('p1')

        const app = createApp({
            render: () => h(TaleswordsPlayer, { projectId: projectId.value, apiBase: API_BASE, onState: listener.onState })
        })
        app.mount(element)
        apps.push(app)
        expect(shell(element).getAttribute('data-state')).toBe('loading')

        projectId.value = 'p2'
        await nextTick()
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text))
        expect(byProject.stub).toHaveBeenCalledTimes(2)
        expectHeard(listener, ['ready'])

        byProject.answerFirst(ok(LINE_1))
        await tick()
        await tick()
        expectHeard(listener, ['ready'])
        expect(element.children[0]!.children).toHaveLength(1)
        expect(shell(element).querySelector('[data-taleswords-text]')?.textContent).toBe(LINE_2.text)

        vi.unstubAllGlobals()

        // (2) a copy wording changed in place, as in [rB]
        const byCopy = deferFirstFetch({ status: 404, body: NOT_FOUND_BODY })
        const copied = host()
        const copyListener = listen(copied)
        const copy = reactive<Partial<PlayerCopy>>({ unavailable: 'X' })

        const copyApp = createApp({
            render: () => h(TaleswordsPlayer, { projectId: 'p1', apiBase: API_BASE, copy, onState: copyListener.onState })
        })
        copyApp.mount(copied)
        apps.push(copyApp)
        expect(shell(copied).getAttribute('data-state')).toBe('loading')

        copy.unavailable = 'Y'
        await vi.waitFor(() => expect(shell(copied).querySelector('[data-taleswords-unavailable]')?.textContent).toBe('Y'))
        expect(byCopy.stub).toHaveBeenCalledTimes(2)
        expectHeard(copyListener, ['unavailable'])

        byCopy.answerFirst(ok(LINE_1))
        await tick()
        await tick()
        expectHeard(copyListener, ['unavailable'])
        expectRefusal(copied, 'Y')
    })

    it('[s9] nothing is heard after the app unmounts, after ready or while the start read is pending, and the host stays empty', async () => {
        // (1) unmount after ready
        stubFetch(ok(LINE_1))
        const element = host()
        const listener = listen(element)
        const settledApp = mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
        await settled(element, 'ready')
        expectHeard(listener, ['ready'])

        unmountWrapper(settledApp)
        await tick()
        expectHeard(listener, ['ready'])
        expect(element.innerHTML).toBe('')

        // (2) unmount while the start read is pending, after which it answers, as in [w6]
        const pending = deferFirstFetch()
        const pendingListener = listen()
        const pendingApp = mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, pendingListener.onState)
        expect(shell(element).getAttribute('data-state')).toBe('loading')

        unmountWrapper(pendingApp)
        expect(element.innerHTML).toBe('')
        pending.answerFirst(ok(LINE_1))
        await tick()
        await tick()

        expect(pending.stub).toHaveBeenCalledTimes(1)
        expect(pendingListener.heard).toEqual([])
        expect(pendingListener.arities).toEqual([])
        expect(element.innerHTML).toBe('')
        expectHeard(listener, ['ready'])
    })

    it('[s10] every payload across all five states is one bare string of the closed set, the only argument, naming no cause', async () => {
        stubFetch(
            ok(LINE_2),
            { status: 500, body: SERVER_ERROR_BODY },
            ok(LINE_2),
            ok(END_OF_ROAD),
            ok(LINE_2),
            { status: 404, body: NOT_FOUND_BODY }
        )
        const element = host()
        const walk = listen(element)

        mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, walk.onState)
        await settled(element, 'ready')
        clickContinue(element)
        await settled(element, 'error')
        clickRestart(element)
        await settled(element, 'ready')
        clickContinue(element)
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())
        clickRestart(element)
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-continue]')).not.toBeNull())
        clickContinue(element)
        await settled(element, 'unavailable')
        await tick()

        expectHeard(walk, ['ready', 'error', 'ready', 'ended', 'ready', 'unavailable'])
        expectNoLeak(walk)

        vi.unstubAllGlobals()

        stubFetch({ status: 404, body: NO_MAIN_SCENE_BODY })
        const refused = host()
        const start = listen(refused)
        mountHeard(refused, { projectId: 'p1', apiBase: API_BASE }, start.onState)
        await settled(refused, 'not-ready')
        await tick()

        expectHeard(start, ['not-ready'])
        expectNoLeak(start)

        const everything = [...walk.heard, ...start.heard]
        expect([...new Set(everything)].sort()).toEqual([...HOST_STATES].sort())
        for (const item of everything) {
            expect(item).not.toBeTypeOf('object')
            expect(item).toBeTypeOf('string')
        }
    })

    it('[s11] a listener adds no DOM listener on the host, the root div, document or window, spied before mount', async () => {
        const element = host()
        // The addEventListener the host, document and window inherit, each owner spied once before the root div
        // exists, so the div Vue creates during mount (and every other node) is bound through the same spy.
        const owners = new Set<object>()
        for (const target of [element, document, window] as object[]) {
            let owner: object | null = target
            while (owner && !Object.prototype.hasOwnProperty.call(owner, 'addEventListener')) owner = Object.getPrototypeOf(owner)
            owners.add(owner!)
        }
        const spies = [...owners].map(owner => vi.spyOn(owner as EventTarget, 'addEventListener'))
        for (const target of [element, document, window]) expect(vi.isMockFunction(target.addEventListener)).toBe(true)

        stubFetch(ok(LINE_2), ok(END_OF_ROAD))
        const listener = listen(element)
        mountHeard(element, { projectId: 'p1', apiBase: API_BASE }, listener.onState)
        await settled(element, 'ready')
        clickContinue(element)
        await vi.waitFor(() => expect(shell(element).querySelector('[data-taleswords-ending]')).not.toBeNull())
        await tick()
        expectHeard(listener, ['ready', 'ended'])

        const rootDiv = element.children[0]!
        expect(rootDiv.tagName).toBe('DIV')
        expect(shell(element).parentElement).toBe(rootDiv)

        expect(vi.isMockFunction(rootDiv.addEventListener)).toBe(true)
        const targets = spies.flatMap(spy => spy.mock.contexts as unknown[])
        for (const [target, name] of [
            [element, 'host element'],
            [rootDiv, 'root div'],
            [document, 'document'],
            [window, 'window']
        ] as const) {
            expect(targets.some(context => context === target), name).toBe(false)
        }
        // The spy is live: the player's own buttons were bound through it, and those do not count.
        expect(targets.some(context => (context as Element).tagName === 'BUTTON')).toBe(true)
    })

    it("[s12] the README names TaleswordsPlayer's 'state' event and its five values in a section between Mount options and Development", () => {
        const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
        const lines = readFileSync(join(packageRoot, 'README.md'), 'utf8').split('\n')
        const headings = lines.filter(line => line.startsWith('## '))

        const mountOptions = headings.indexOf('## Mount options')
        expect(mountOptions).toBeGreaterThan(-1)
        expect(headings[mountOptions + 1]).toBe('## Vue component')
        expect(headings[mountOptions + 2]).toBe('## Development')

        const section = lines.slice(lines.indexOf('## Vue component') + 1, lines.indexOf('## Development')).join('\n')
        expect(section).toContain('TaleswordsPlayer')
        expect(section).toContain('`state`')
        expect(section).toContain('@state')
        expect(section).toContain('onState')
        for (const value of HOST_STATES) expect(section, value).toContain(`'${value}'`)

        // The values it names are the onState table's of Mount options.
        const options = lines.slice(lines.indexOf('## Mount options') + 1, lines.indexOf('## Vue component')).join('\n')
        for (const value of HOST_STATES) expect(options, value).toContain(`| \`'${value}'\` |`)

        const row = lines.find(line => line.startsWith('| `@taleswords/player/components` |'))
        expect(row).toBeDefined()
        expect(row).not.toContain('(coming)')
        expect(row).toContain('Vue 3 `TaleswordsPlayer` component')
    })
})
