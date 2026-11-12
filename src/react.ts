// SPDX-License-Identifier: MIT
// React components entry: the React wrapper around the mount API lands here.
'use client';

import { createElement, useEffect, useRef } from 'react'
import { mount, type PlayerCopy, type PlayerHandle, type PlayerHostState } from './browser.js'

export type { PlayerCopy, PlayerHandle, PlayerState, PlayerHostState } from './browser.js'

/** What the React player takes: the same options the Vue player takes, with its 'state' event as onState. */
export type TaleswordsPlayerProps = {
    projectId: string
    apiBase: string
    copy?: Partial<PlayerCopy> | undefined
    onState?: ((state: PlayerHostState) => void) | undefined
}

/**
 * The React player: one div that holds the same reader's walk the static embed
 * mounts. It mounts after the div is attached, mounts again on the same div when
 * projectId, apiBase or any copy wording changes value (mount replaces the
 * earlier walk, so the story starts over), and unmounts when it goes away. A
 * copy object equal in value to the last one, new or the same, does not remount
 * it, and neither does a new onState callback. Errors that mount throws are not
 * caught.
 */
export function TaleswordsPlayer(props: TaleswordsPlayerProps) {
    const { projectId, apiBase, copy, onState } = props
    const ref = useRef<HTMLDivElement | null>(null)
    const onStateRef = useRef(onState)
    onStateRef.current = onState

    const wording = copy
        ? (Object.keys(copy) as (keyof PlayerCopy)[]).sort().map(key => [key, copy[key]])
        : null
    const copyKey = JSON.stringify(wording)

    useEffect(() => {
        const host = ref.current
        if (host === null) return
        const handle: PlayerHandle = mount(host, {
            projectId,
            apiBase,
            ...(copy ? { copy } : {}),
            onState: (state: PlayerHostState) => onStateRef.current?.(state)
        })
        return () => {
            handle.unmount()
        }
    }, [projectId, apiBase, copyKey])

    return createElement('div', { ref })
}
