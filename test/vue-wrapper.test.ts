// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import { TaleswordsPlayer, type PlayerCopy } from '../src/components.js'

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
