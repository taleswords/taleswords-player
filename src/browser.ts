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
 * then ready, unavailable or error. An unavailable settle shows the refusal
 * copy and no story; an error settle leaves the shell empty.
 */

import type { RuntimeAdvanceRequest, RuntimeCharacterDTO, RuntimeEndingStateDTO, RuntimeLineStateDTO, RuntimeStateDTO } from './contract.js'

/** Where a mounted player stands once its read has settled. */
export type PlayerState = 'ready' | 'unavailable' | 'error'

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
    unavailable: string
    error: string
}

type MountOptions = { projectId: string; apiBase: string; copy?: Partial<PlayerCopy> | undefined }

/** The reader's words in English, each overridable through the mount's copy option. */
const DEFAULT_COPY: PlayerCopy = {
    continue: 'Continue',
    restart: 'Start again',
    endOfRoad: 'The story goes no further from here.',
    unavailable: 'This story is not available.',
    error: 'The story could not be loaded.'
}

/** The player each element currently holds, so a second mount replaces the first. */
const mounted = new WeakMap<Element, PlayerHandle>()

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0
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
type ReadResult = { state: 'ready'; body: RuntimeStateDTO } | { state: 'unavailable' | 'error' }

function isRuntimeState(body: unknown): body is RuntimeStateDTO {
    if (typeof body !== 'object' || body === null) return false
    const { type, choices } = body as { type?: unknown; choices?: unknown }
    if (type === 'ending') return true
    return type === 'line' && Array.isArray(choices)
}

/** One anonymous runtime read. Never rejects: 404 is unavailable, anything else not ok is error. */
async function read(url: string, init: RequestInit): Promise<ReadResult> {
    try {
        const response = await fetch(url, init)
        if (response.status === 404) return { state: 'unavailable' }
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

/** A line: scene image, portrait, text, then its choices in order, or one continue. */
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
    } else {
        view.appendChild(button(doc, controls.copy.continue, 'data-taleswords-continue', () => controls.advance()))
    }
    return view
}

/** An ending with a nodeId is authored; one without is the end of the road, offering restart alone. */
function renderEnding(doc: Document, state: RuntimeEndingStateDTO, controls: Controls): HTMLElement {
    const view = doc.createElement('div')
    if (isNonEmptyString(state.nodeId)) {
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
 * is unmounted first. Unknown and unpublished projects both settle
 * 'unavailable' and show the refusal copy: the read cannot tell them apart, by
 * design, so the refusal names no cause. The optional copy
 * replaces any of the reader's own words; story text is never replaced.
 */
export function mount(element: Element, options: MountOptions): PlayerHandle {
    if (typeof Element === 'undefined' || !(element instanceof Element)) {
        throw new TypeError('TaleswordsPlayer.mount: element must be an Element')
    }
    const { projectId, apiBase, copy } = (options ?? {}) as Partial<MountOptions>
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
    const projectUrl = base + '/api/v1/runtime/projects/' + encodeURIComponent(projectId)
    const startUrl = projectUrl + '/start'

    let imageBase = ''
    try {
        imageBase = new URL(apiBase.trim(), doc.baseURI).href
    } catch {
        // An apiBase that does not resolve leaves every image unresolved, and so unshown.
    }

    const readStart = (): Promise<ReadResult> =>
        read(startUrl, { method: 'GET', credentials: 'omit', signal: controller.signal })

    const readNext = (state: RuntimeStateDTO, choiceId?: string): Promise<ReadResult> => {
        if (!isNonEmptyString(state.nodeId)) return Promise.resolve({ state: 'error' })
        const request: RuntimeAdvanceRequest = {
            callStack: state.callStack,
            rootContainerId: state.rootContainerId,
            rootContainerType: state.rootContainerType
        }
        if (choiceId !== undefined) request.choiceId = choiceId
        return read(projectUrl + '/node/' + encodeURIComponent(state.nodeId) + '/next', {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal
        })
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
            root.replaceChildren(
                result.body.type === 'ending'
                    ? renderEnding(doc, result.body, controls)
                    : renderLine(doc, result.body, controls)
            )
        } else {
            current = undefined
            if (result.state === 'unavailable') root.replaceChildren(renderUnavailable(doc, controls))
            else root.replaceChildren(renderError(doc, controls))
        }
        root.setAttribute('data-state', result.state)
        return result.state
    }

    /** One advance or restart at a time; its controls are disabled while it is in flight. */
    function act(next: () => Promise<ReadResult>): void {
        if (!active || busy) return
        busy = true
        for (const control of root.querySelectorAll('button')) control.disabled = true
        void next().then(result => {
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
