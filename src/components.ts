// SPDX-License-Identifier: MIT
// Framework components entry: the wrappers around the mount API land here.

import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { mount, type PlayerCopy, type PlayerHandle } from './browser.js'

export type { PlayerCopy, PlayerHandle, PlayerState } from './browser.js'

/**
 * The Vue 3 player: one div that holds the same reader's walk the static embed
 * mounts. It mounts on insert, mounts again on the same div when projectId,
 * apiBase or any copy wording changes value (mount replaces the earlier walk,
 * so the story starts over), and unmounts when it goes away. A copy object
 * equal in value to the last one, new or the same, does not remount it.
 * Errors that mount throws are not caught.
 */
export const TaleswordsPlayer = defineComponent({
    name: 'TaleswordsPlayer',
    props: {
        projectId: { type: String, required: true },
        apiBase: { type: String, required: true },
        copy: { type: Object as PropType<Partial<PlayerCopy>>, required: false }
    },
    setup(props) {
        const host = ref<HTMLDivElement | null>(null)
        let handle: PlayerHandle | null = null

        function mountPlayer(): void {
            if (host.value === null) return
            const { projectId, apiBase, copy } = props
            handle = mount(host.value, { projectId, apiBase, ...(copy ? { copy } : {}) })
        }

        onMounted(mountPlayer)
        watch(() => {
            const copy = props.copy
            const wording = copy
                ? (Object.keys(copy) as (keyof PlayerCopy)[]).sort().map(key => [key, copy[key]])
                : null
            return JSON.stringify([props.projectId, props.apiBase, wording])
        }, mountPlayer)
        onBeforeUnmount(() => {
            handle?.unmount()
            handle = null
        })

        return () => h('div', { ref: host })
    }
})
