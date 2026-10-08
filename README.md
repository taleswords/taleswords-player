# @taleswords/player

Embeddable [Taleswords](https://github.com/taleswords) story player: a one-script-tag bundle for static sites, plus components for the major frontend frameworks.

> **Status: pre-release.** The package currently ships the runtime read contract (the types every Taleswords runtime endpoint answers with) and the reader URL helper. The mount API, the browser bundle and the framework components are being built here next. Nothing is published to npm yet.

## What it will do

- **Static sites:** load one script, point it at an element and a project id, and the published story plays there. No build step on the host page.
- **Frameworks:** thin components around that same mount API, which mount and unmount cleanly.
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
| `@taleswords/player/browser` | the browser mount API (coming) |
| `@taleswords/player/components` | framework components (coming) |

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
