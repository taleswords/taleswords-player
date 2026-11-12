// SPDX-License-Identifier: MIT

/**
 * Browser bundle entry: the mount API for static pages.
 *
 * A static page loads build/player.iife.js, which exposes these exports on the
 * global TaleswordsPlayer, and calls
 *
 *     TaleswordsPlayer.mount(element, { projectId, apiBase })
 *
 * The mount appends one shell to the element, makes one anonymous read of the
 * published story's start, and renders the reader's walk inside the shell: each
 * line with its scene image, portrait, text and choices or continue, then the
 * authored ending or, where the story stops without one, the end-of-road panel
 * with restart. The shell's data-state attribute says where it stands: loading,
 * then ready, unavailable, not-ready or error, or dead-end on a line whose every
 * choice is unavailable, which shows its notice and restart and still settles
 * ready. An unavailable settle shows its copy ('This story is not available.' by
 * default) and no story and no control. A not-ready settle shows its copy ('This
 * story is not ready yet.' by default) and no story and no control. An error
 * settle shows the error copy ('The story could not be loaded.' by default) and
 * one enabled 'Start again' control that re-reads the start, and names no cause.
 * Each copy can be overridden through options.copy.
 */

import type { RuntimeAdvanceRequest, RuntimeCharacterDTO, RuntimeEndingStateDTO, RuntimeLineStateDTO, RuntimeStateDTO } from './contract.js'

/** Where a mounted player stands once its read has settled. */
export type PlayerState = 'ready' | 'unavailable' | 'not-ready' | 'error'

/** What the mount's onState option is told after each settled read: a PlayerState, or 'ended' when an ending is shown. */
export type PlayerHostState = PlayerState | 'ended'

/** What mount returns: the way to take the player down, and its settled state. */
export type PlayerHandle = {
    unmount(): void
    ready: Promise<PlayerState>
}

/** The reader's own words. Story text always comes from the story. */
export type PlayerCopy = {
    continue: string
    restart: string
    endOfRoad: string
    deadEnd: string
    unavailable: string
    notReady: string
    error: string
}

type MountOptions = {
    projectId: string
    apiBase: string
    copy?: Partial<PlayerCopy> | undefined
    onState?: ((state: PlayerHostState) => void) | undefined
}

/** The reader's words in English, each overridable through the mount's copy option. */
const DEFAULT_COPY: PlayerCopy = {
    continue: 'Continue',
    restart: 'Start again',
    endOfRoad: 'The story goes no further from here.',
    deadEnd: 'The story cannot continue from here.',
    unavailable: 'This story is not available.',
    notReady: 'This story is not ready yet.',
    error: 'The story could not be loaded.'
}

/** The player each element currently holds, so a second mount replaces the first. */
const mounted = new WeakMap<Element, PlayerHandle>()

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0
}

/** Whether an authored ending carries anything to show: the resolver's hasAuthoredEnding rule, '' empty and whitespace filled. */
function hasAuthoredContent(ending: RuntimeEndingStateDTO['ending'] | null): boolean {
    if (ending === undefined || ending === null) return false
    return isNonEmptyString(ending.title) || isNonEmptyString(ending.text) || Boolean(ending.character) || isNonEmptyString(ending.imageUrl)
}

/** The default copy, with every string the caller gave for a known key laid over it. */
function resolveCopy(copy: unknown): PlayerCopy {
    const resolved = { ...DEFAULT_COPY }
    if (typeof copy !== 'object' || copy === null) return resolved
    for (const key of Object.keys(DEFAULT_COPY) as (keyof PlayerCopy)[]) {
        const value = (copy as Record<string, unknown>)[key]
        if (typeof value === 'string') resolved[key] = value
    }
    return resolved
}

/** What one read answered: a state to render, or the state the shell settles in. */
type ReadResult = { state: 'ready'; body: RuntimeStateDTO } | { state: 'unavailable' | 'not-ready' | 'error' }

function isRuntimeState(body: unknown): body is RuntimeStateDTO {
    if (typeof body !== 'object' || body === null) return false
    const { type, choices } = body as { type?: unknown; choices?: unknown }
    if (type === 'ending') return true
    return type === 'line' && Array.isArray(choices)
}

// The runtime's wire code for a published story with no main scene.
const STORY_NOT_READY_CODE = 'story_not_ready'

/**
 * One anonymous runtime read. Never rejects: 404 whose errors[0].code is story_not_ready is
 * not-ready, any other 404 is unavailable, anything else not ok is error.
 */
async function read(url: string, init: RequestInit): Promise<ReadResult> {
    try {
        const response = await fetch(url, init)
        if (response.status === 404) {
            try {
                const refusal = (await response.json()) as { errors?: { code?: unknown }[] } | null
                if (Array.isArray(refusal?.errors) && refusal.errors[0]?.code === STORY_NOT_READY_CODE) {
                    return { state: 'not-ready' }
                }
            } catch {
                // A 404 body that does not parse is the plain refusal.
            }
            return { state: 'unavailable' }
        }
        if (!response.ok) return { state: 'error' }
        const body: unknown = await response.json()
        if (!isRuntimeState(body)) return { state: 'error' }
        return { state: 'ready', body }
    } catch {
        return { state: 'error' }
    }
}

/** What the rendered controls may ask of the mount. */
type Controls = {
    copy: PlayerCopy
    imageBase: string
    advance(choiceId?: string): void
    restart(): void
}

/** An image for a root-relative upload path, resolved against the API's base; none when the path does not resolve. */
function image(doc: Document, path: string | undefined, controls: Controls, marker: string, alt: string): HTMLImageElement | null {
    if (!isNonEmptyString(path)) return null
    let src: string
    try {
        src = new URL(path, controls.imageBase).href
    } catch {
        return null
    }
    const img = doc.createElement('img')
    img.setAttribute(marker, '')
    img.alt = alt
    img.src = src
    return img
}

function portrait(doc: Document, character: RuntimeCharacterDTO | undefined, controls: Controls): HTMLImageElement | null {
    if (!character) return null
    return image(doc, character.imageUrl, controls, 'data-taleswords-portrait', typeof character.name === 'string' ? character.name : '')
}

function paragraph(doc: Document, text: string | undefined, marker: string): HTMLParagraphElement | null {
    if (!isNonEmptyString(text)) return null
    const p = doc.createElement('p')
    p.setAttribute(marker, '')
    p.textContent = text
    return p
}

function button(doc: Document, label: string, marker: string, onClick: () => void): HTMLButtonElement {
    const control = doc.createElement('button')
    control.type = 'button'
    control.setAttribute(marker, '')
    control.textContent = label
    control.addEventListener('click', onClick)
    return control
}

function append(parent: Element, ...children: (Element | null)[]): void {
    for (const child of children) if (child) parent.appendChild(child)
}

/** A line whose every choice is unavailable: nothing on it moves the story on. */
function isDeadEnd(state: RuntimeLineStateDTO): boolean {
    return state.choices.length > 0 && state.choices.every(choice => choice.isUnavailable === true)
}

/** A line: scene image, portrait, text, then its choices in order, or one continue; a dead end adds the notice and restart. */
function renderLine(doc: Document, state: RuntimeLineStateDTO, controls: Controls): HTMLElement {
    const view = doc.createElement('div')
    view.setAttribute('data-taleswords-line', '')
    append(
        view,
        image(doc, state.scene?.imageUrl, controls, 'data-taleswords-scene', ''),
        portrait(doc, state.character, controls),
        paragraph(doc, state.text, 'data-taleswords-text')
    )
    if (state.choices.length > 0) {
        const choices = doc.createElement('div')
        choices.setAttribute('data-taleswords-choices', '')
        for (const choice of state.choices) {
            const unavailable = choice.isUnavailable === true
            const control = button(doc, String(choice.label ?? ''), 'data-taleswords-choice', () => {
                // The server never checks availability: an unavailable choice is never posted.
                if (!unavailable) controls.advance(choice.choiceId)
            })
            control.disabled = unavailable
            choices.appendChild(control)
        }
        view.appendChild(choices)
        if (isDeadEnd(state)) {
            const notice = doc.createElement('p')
            notice.setAttribute('data-taleswords-notice', 'dead-end')
            notice.textContent = controls.copy.deadEnd
            append(view, notice, button(doc, controls.copy.restart, 'data-taleswords-restart', () => controls.restart()))
        }
    } else {
        view.appendChild(button(doc, controls.copy.continue, 'data-taleswords-continue', () => controls.advance()))
    }
    return view
}

/** An ending whose reason is 'authored' is the author's; any other reason is the end of the road, offering restart alone. */
function renderEnding(doc: Document, state: RuntimeEndingStateDTO, controls: Controls): HTMLElement {
    const view = doc.createElement('div')
    if (state.reason === 'authored' && hasAuthoredContent(state.ending)) {
        view.setAttribute('data-taleswords-ending', 'authored')
        const ending = state.ending
        append(
            view,
            image(doc, ending?.imageUrl, controls, 'data-taleswords-ending-image', ''),
            portrait(doc, ending?.character, controls),
            paragraph(doc, ending?.title, 'data-taleswords-ending-title'),
            paragraph(doc, ending?.text, 'data-taleswords-ending-text')
        )
        return view
    }
    view.setAttribute('data-taleswords-ending', 'end-of-road')
    append(
        view,
        paragraph(doc, controls.copy.endOfRoad, 'data-taleswords-end-of-road'),
        button(doc, controls.copy.restart, 'data-taleswords-restart', () => controls.restart())
    )
    return view
}

/** The refusal shown when the story's project cannot be opened: the copy alone, no story and no control. */
function renderUnavailable(doc: Document, controls: Controls): HTMLElement {
    const view = doc.createElement('div')
    view.setAttribute('data-taleswords-refusal', 'unavailable')
    append(view, paragraph(doc, controls.copy.unavailable, 'data-taleswords-unavailable'))
    return view
}

/** The refusal shown when the story is published without a main scene: the copy alone, no story and no control. */
function renderNotReady(doc: Document, controls: Controls): HTMLElement {
    const view = doc.createElement('div')
    view.setAttribute('data-taleswords-refusal', 'not-ready')
    append(view, paragraph(doc, controls.copy.notReady, 'data-taleswords-not-ready'))
    return view
}

/** The refusal shown when a read fails: the copy and one control that re-reads the start, no cause. */
function renderError(doc: Document, controls: Controls): HTMLElement {
    const view = doc.createElement('div')
    view.setAttribute('data-taleswords-refusal', 'error')
    append(
        view,
        paragraph(doc, controls.copy.error, 'data-taleswords-error'),
        button(doc, controls.copy.restart, 'data-taleswords-restart', () => controls.restart())
    )
    return view
}

/**
 * Mount a player into the element against a published project.
 *
 * Throws a TypeError when the element is not an Element, or when projectId or
 * apiBase is not a non-empty string. A player already mounted on the element
 * is unmounted first. For a well-formed project id, unknown and unpublished
 * projects both settle 'unavailable' and show the refusal copy: the read cannot
 * tell them apart, by design, so the refusal names no cause. An id that is not a
 * well-formed project id settles 'error' and shows the error view with 'Start
 * again'. A published story with no main scene
 * settles 'not-ready' and shows the not-ready copy. The optional copy
 * replaces any of the reader's own words; story text is never replaced.
 */
export function mount(element: Element, options: MountOptions): PlayerHandle {
    if (typeof Element === 'undefined' || !(element instanceof Element)) {
        throw new TypeError('TaleswordsPlayer.mount: element must be an Element')
    }
    const { projectId, apiBase, copy, onState: givenOnState } = (options ?? {}) as Partial<MountOptions>
    // An onState that is not a function is ignored, as resolveCopy ignores bad copy.
    const onState = typeof givenOnState === 'function' ? givenOnState : undefined
    if (!isNonEmptyString(projectId)) {
        throw new TypeError('TaleswordsPlayer.mount: projectId must be a non-empty string')
    }
    if (!isNonEmptyString(apiBase)) {
        throw new TypeError('TaleswordsPlayer.mount: apiBase must be a non-empty string')
    }

    mounted.get(element)?.unmount()

    const doc = element.ownerDocument
    const root = doc.createElement('div')
    root.setAttribute('data-taleswords-player', '')
    root.setAttribute('data-state', 'loading')
    element.appendChild(root)

    const controller = new AbortController()
    let active = true
    let busy = false
    let current: RuntimeStateDTO | undefined
    let settle: (state: PlayerState) => void = () => {}
    const ready = new Promise<PlayerState>(resolve => {
        settle = resolve
    })

    const base = apiBase.trim().replace(/\/+$/, '')
    let projectUrl = ''
    let startUrl = ''
    let unencodable = false
    try {
        projectUrl = base + '/api/v1/runtime/projects/' + encodeURIComponent(projectId)
        startUrl = projectUrl + '/start'
    } catch {
        // An id that cannot be encoded (a lone surrogate) is never sent: every start read settles 'error'.
        unencodable = true
    }

    let imageBase = ''
    try {
        imageBase = new URL(apiBase.trim(), doc.baseURI).href
    } catch {
        // An apiBase that does not resolve leaves every image unresolved, and so unshown.
    }

    const readStart = (): Promise<ReadResult> =>
        unencodable
            ? Promise.resolve({ state: 'error' })
            : read(startUrl, { method: 'GET', credentials: 'omit', signal: controller.signal })

    const readNext = (state: RuntimeStateDTO, choiceId?: string): Promise<ReadResult> => {
        if (!isNonEmptyString(state.nodeId)) return Promise.resolve({ state: 'error' })
        const request: RuntimeAdvanceRequest = {
            callStack: state.callStack,
            rootContainerId: state.rootContainerId,
            rootContainerType: state.rootContainerType
        }
        if (choiceId !== undefined) request.choiceId = choiceId
        // Mid-walk, not-ready is the plain refusal, as before: only the start read tells it apart.
        return read(projectUrl + '/node/' + encodeURIComponent(state.nodeId) + '/next', {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal
        }).then((result): ReadResult => (result.state === 'not-ready' ? { state: 'unavailable' } : result))
    }

    const controls: Controls = {
        copy: resolveCopy(copy),
        imageBase,
        advance(choiceId) {
            const state = current
            if (state) act(() => readNext(state, choiceId))
        },
        restart() {
            act(readStart)
        }
    }

    /** Render what a read answered in place of the last state, and set the shell's state. */
    function show(result: ReadResult): PlayerState {
        if (result.state === 'ready') {
            current = result.body
            try {
                root.replaceChildren(
                    result.body.type === 'ending'
                        ? renderEnding(doc, result.body, controls)
                        : renderLine(doc, result.body, controls)
                )
            } catch {
                // A state the player cannot render settles as a failed read does; the error branch clears current.
                return show({ state: 'error' })
            }
        } else {
            current = undefined
            if (result.state === 'unavailable') root.replaceChildren(renderUnavailable(doc, controls))
            else if (result.state === 'not-ready') root.replaceChildren(renderNotReady(doc, controls))
            else root.replaceChildren(renderError(doc, controls))
        }
        // A dead-end line marks the shell on its own, yet settles 'ready' like any line.
        const deadEnd = result.state === 'ready' && result.body.type === 'line' && isDeadEnd(result.body)
        root.setAttribute('data-state', deadEnd ? 'dead-end' : result.state)
        // The host is told the state name only: 'ended' for either ending view, else the settled state.
        const ended = result.state === 'ready' && result.body.type === 'ending'
        emit(ended ? 'ended' : result.state)
        return result.state
    }

    /** Tell the host where the player stands; nothing once unmounted, and a host throw never reaches the walk. */
    function emit(state: PlayerHostState): void {
        if (!active || !onState) return
        try {
            onState(state)
        } catch {
            // The host's own failure is the host's: the walk and ready go on unchanged.
        }
    }

    /** One advance or restart at a time; its controls are disabled while it is in flight. */
    function act(next: () => Promise<ReadResult>): void {
        if (!active || busy) return
        busy = true
        for (const control of root.querySelectorAll('button')) control.disabled = true
        let pending: Promise<ReadResult>
        try {
            pending = next()
        } catch {
            // A read that cannot be built (an id that cannot be encoded) is never sent: it settles 'error'.
            pending = Promise.resolve({ state: 'error' })
        }
        void pending
            .catch((): ReadResult => ({ state: 'error' }))
            .then(result => {
                busy = false
                // After unmount a late answer writes nothing.
                if (!active) return
                show(result)
            })
    }

    void readStart().then(result => {
        // After unmount a late answer writes nothing.
        if (!active) return
        settle(show(result))
    })

    const handle: PlayerHandle = {
        ready,
        unmount() {
            if (!active) return
            active = false
            controller.abort()
            root.remove()
            if (mounted.get(element) === handle) mounted.delete(element)
            // A read that had not settled ends as 'error'; a settled one keeps its state.
            settle('error')
        }
    }
    mounted.set(element, handle)
    return handle
}
