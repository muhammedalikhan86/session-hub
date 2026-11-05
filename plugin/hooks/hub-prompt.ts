import { LIST_TOOL } from './list-sessions'
import { HUB_NAME, SEND_TOOL } from './send'

export const HUB_PROMPT_ID = 'session-hub:joined'

const TOOL = `mcp__session-hub__${SEND_TOOL}`
const LIST = `mcp__session-hub__${LIST_TOOL}`

export const hubPromptText = (who: { name: string; role: string }): string => {
  const head =
    `This session is joined to Session Hub as "${who.name}". ` +
    `To message other Session Hub sessions use the ${TOOL} tool, ` +
    "not Claude Code's built-in session messaging or local session list. "

  const role =
    who.role === 'hub'
      ? `You are the ${HUB_NAME}: set "to" to a session name, or "*" for every session; your messages are orders. ` +
        `Use ${LIST} to see which sessions are live.`
      : `You are a worker: every message goes to the ${HUB_NAME} only; ` +
        'when answering an order set "replyTo" to its id.'

  const tail =
    ' Prompts starting "[Hub order ...]", "[Reply from ...]" or "[Message from ...]" come from Session Hub. ' +
    'Never send secrets, passwords or tokens.'

  return head + role + tail
}

// The section list as `prompt.compose` answers it, with the joined-session section added last.
export const withHubSection = <S extends { id: string }>(
  sections: readonly S[],
  joined: { name: string; role: string } | undefined,
  make: (id: string, text: string) => S,
): readonly S[] =>
  joined
    ? [...sections.filter(s => s.id !== HUB_PROMPT_ID), make(HUB_PROMPT_ID, hubPromptText(joined))]
    : sections
