# @taleswords/player

Embeddable [Taleswords](https://github.com/taleswords) story player: a one-script-tag bundle for static sites, plus a Vue 3 component.

> **Status: pre-release.** The package currently ships the runtime read contract (the types every Taleswords runtime endpoint answers with) and the reader URL helper. It also ships the browser mount API (`@taleswords/player/browser`, `mount(element, options)`), the browser bundle `build/player.iife.js`, which exposes the `TaleswordsPlayer` global, and the Vue 3 `TaleswordsPlayer` component (`@taleswords/player/components`). Nothing is published to npm yet.

## What it does

- **Static sites:** load one script, `build/player.iife.js`, call `TaleswordsPlayer.mount(element, { projectId, apiBase })` with an element and a project id, and the published story plays there. No build step on the host page. This is the supported path for every site not on Vue 3.3 or later: see [Who can install what](#who-can-install-what).
- **Frameworks:** the Vue 3 `TaleswordsPlayer` component in `@taleswords/player/components` is a thin component around that same mount API, which mounts and unmounts cleanly.
- **Read-only:** the player only reads published stories. It carries no authoring code and no credentials.

## What is here today

```ts
import type { RuntimeStateDTO, RuntimeChoiceDTO } from '@taleswords/player'
import { readerLink } from '@taleswords/player'

readerLink('my-project-id', 'https://stories.example.org')
// -> 'https://stories.example.org/read/my-project-id'
```

| Entry | Contents |
|---|---|
| `@taleswords/player` | runtime contract types, `readerLink`, `READER_PATH_PATTERN` |
| `@taleswords/player/browser` | the browser mount API: `mount(element, options)`, returning `{ unmount, ready }`; also the `TaleswordsPlayer` global of `build/player.iife.js` |
| `@taleswords/player/components` | framework components: the Vue 3 `TaleswordsPlayer` component (see [Vue component](#vue-component)) |

The mount API and the browser bundle are documented under [Mount options](#mount-options).

## Who can install what

`@taleswords/player` is one package. Its wrappers are not split into packages of their own.

**A site on Vue 3.3 or later** installs `@taleswords/player` from npm, once a release is published, and uses the `TaleswordsPlayer` component from `@taleswords/player/components`.

The package declares `vue` as an optional peer dependency with the range `^3.3.0`. The `Player Vue Floor` CI job in the TalesWords repository installs the lowest version that range allows and runs this package's specs against it.

**Every other site, including Vue 3 sites below 3.3, Vue 2 sites and React-only sites,** uses the plain CDN / browser embed. It is the supported path for those sites and needs no npm install. Load the script, then call `TaleswordsPlayer.mount(element, { projectId, apiBase })`:

```html
<script src="https://unpkg.com/@taleswords/player/build/player.iife.js"></script>
```

The same file is at `https://cdn.jsdelivr.net/npm/@taleswords/player/build/player.iife.js`. Both addresses name the published package, and nothing is published to npm yet, so they answer only after the first release.

**npm's refusal on a Vue 2 site is expected.** Measured on npm 12.0.2, installing this package beside vue 2.7.16 fails with `ERESOLVE`, because the peer range does not allow it. Marking the peer optional does not relax the range. npm 7 to 11 were not measured. Such a site, like a Vue 3 site below 3.3, uses the embed above.

## Mount options

```ts
TaleswordsPlayer.mount(element, { projectId, apiBase, copy, onState })
```

| Option | Meaning |
|---|---|
| `projectId` | required, non-empty string: the published project to play |
| `apiBase` | required, non-empty string: the base URL of the Taleswords API the story is read from |
| `copy` | optional: replaces any of the reader's own words (`continue`, `restart`, `endOfRoad`, `deadEnd`, `unavailable`, `notReady`, `error`); story text is never replaced |
| `onState` | optional function: told where the player stands after each settled read |

### `onState`

`onState(state)` is called once per settled read: once for the start read, once after each advance, and once after each restart. It is never called after `unmount()`, so taking the player down or mounting another player on the same element is not reported. A value that is not a function is ignored, and an error thrown by `onState` never stops the player.

`state` is always one of these values:

| Value | Meaning |
|---|---|
| `'ready'` | opened: a line is shown (a line whose every choice is unavailable included) |
| `'unavailable'` | refused: the project cannot be opened |
| `'not-ready'` | refused: the story is published without a main scene (start read only) |
| `'ended'` | ended: the authored ending or the end-of-road panel is shown |
| `'error'` | failed: the read failed and the error view with Start again is shown |

The payload names the state only: never an object, a cause, a status, a URL or a server message. `ready` and the shell's `data-state` attribute are unchanged by `onState`; for the start read, `onState` is called before `ready` settles.

```js
TaleswordsPlayer.mount(document.getElementById('story'), {
    projectId: 'my-project-id',
    apiBase: 'https://stories.example.org',
    onState(state) {
        if (state === 'ended') showNextChapterLink()
    }
})
```

## Vue component

```ts
import { TaleswordsPlayer } from '@taleswords/player/components'
```

`TaleswordsPlayer` is a Vue 3 component that renders one div and mounts the player in it. It takes the props `projectId` (required string), `apiBase` (required string) and `copy` (optional), with the same meanings as the mount options above.

It declares one event, `state`, heard as `@state` in a template or as `onState` in `h()`. The event fires exactly as `onState` does: once per settled read (the start read, each advance, each restart), with the same five values and meanings as the `onState` table above (`'ready'`, `'unavailable'`, `'not-ready'`, `'ended'`, `'error'`). The payload is the state name only, its one argument.

Nothing is heard after the component unmounts. A change of `projectId`, `apiBase` or any `copy` wording remounts the player, so the story starts over, and only the new mount is heard from then on.

```vue
<TaleswordsPlayer
    project-id="my-project-id"
    api-base="https://stories.example.org"
    @state="state => { if (state === 'ended') showNextChapterLink() }"
/>
```

## Development

This repository is also carried inside the private Taleswords monorepo as a `git subtree` under `packages/player`; work done there is pushed here. Every source file is MIT and opens with `// SPDX-License-Identifier: MIT` — the test suite enforces it.


Requires Node 20 or newer.

```sh
npm ci
npm test      # builds, checks the packed file list and the exports
npm run build # emits build/
```

Releases are cut by pushing a `v<version>` tag that matches `package.json`; CI publishes with npm provenance.

## License

[MIT](LICENSE)
