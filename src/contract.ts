// SPDX-License-Identifier: MIT

/** A choice offered on a line. */
export interface RuntimeChoiceDTO {
    choiceId: string
    label: string
    isUnavailable?: boolean | undefined
}

/** The scene a line plays in. */
export interface RuntimeSceneDTO {
    id: string
    imageUrl?: string | undefined
}

/** The speaking character. */
export interface RuntimeCharacterDTO {
    id: string
    name: string
    imageUrl?: string | undefined
}

/** One frame of the runtime call stack. */
export interface RuntimeCallStackEntry {
    nodeId: string
    containerId: string
    containerType: 'scene' | 'dialogue'
    sourceRefId?: string | undefined
}

/** The ending payload of an ended story. */
export interface RuntimeEndingDTO {
    title?: string | undefined
    text?: string | undefined
    character?: RuntimeCharacterDTO | undefined
    imageUrl?: string | undefined
}

/** The root container every state carries. */
export interface RuntimeRootContainer {
    rootContainerId: string
    rootContainerType: 'scene' | 'dialogue'
}

/** A playable line state (type 'line'). */
export interface RuntimeLineStateDTO extends RuntimeRootContainer {
    type: 'line'
    nodeId: string
    scene?: RuntimeSceneDTO | undefined
    character?: RuntimeCharacterDTO | undefined
    text?: string | undefined
    choices: RuntimeChoiceDTO[]
    isEnded: boolean
    isTerminal: boolean
    callStack: RuntimeCallStackEntry[]
}

/** An ended state (type 'ending'). */
export interface RuntimeEndingStateDTO extends RuntimeRootContainer {
    type: 'ending'
    nodeId?: string | undefined
    isEnded: true
    choices: []
    callStack: []
    ending?: RuntimeEndingDTO | undefined
}

/** The response of every runtime read endpoint. */
export type RuntimeStateDTO = RuntimeLineStateDTO | RuntimeEndingStateDTO

/** Body of POST start. */
export interface RuntimeStartFromRequest {
    startNodeId?: string | undefined
    startContainerId?: string | undefined
    containerType?: 'scene' | 'dialogue' | undefined
    sourceRefId?: string | undefined
}

/** Body of POST next. */
export interface RuntimeAdvanceRequest {
    choiceId?: string | undefined
    callStack?: RuntimeCallStackEntry[] | undefined
    rootContainerId?: string | undefined
    rootContainerType?: 'scene' | 'dialogue' | undefined
}

/** Path params of GET start and POST start. */
export interface RuntimeProjectParams {
    projectId: string
}

/** Path params of GET node and POST next. */
export interface RuntimeNodeParams {
    projectId: string
    nodeId: string
}
