// SPDX-License-Identifier: MIT

/**
 * The URL a reader opens for a published story.
 *
 * This is the single definition of that URL: a host page, the browser bundle
 * and the framework components all build it here, so a link an author copies
 * and a link the player mounts can never disagree. It imports nothing and
 * reads no global, so anything may import it.
 */

/** The reader's path shape. */
export const READER_PATH_PATTERN = '/read/:projectId'

/**
 * The absolute URL a reader opens for the given project, under the given base
 * (an origin, optionally with a path; trailing slashes are ignored).
 */
export function readerLink(projectId: string, baseUrl: string): string {
    const base = baseUrl.trim().replace(/\/+$/, '')
    return `${base}/read/${projectId}`
}
