import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { BaseCheckpointSaver, LangGraphRunnableConfig } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { AgentContext, getAgentContext } from '../tools/define-tool'
import { buildSystemPrompt } from './prompt'

export const AGENT_MODEL = 'deepseek-chat'

// How many earlier messages are sent to the model each turn. Older ones stay
// saved in the chat; they just stop costing tokens.
const MAX_HISTORY_MESSAGES = 30

export interface ModelUsage {
  promptTokens: number
  completionTokens: number
}

export interface AdminAgentGraphOptions {
  tools: StructuredToolInterface[]
  checkpointer: BaseCheckpointSaver
  onModelUsage: (ctx: AgentContext, usage: ModelUsage) => void
  onModelError: (error: unknown) => void
}

// Keeps the last messages, starting at a user message so the model never sees
// a tool result without the tool call that asked for it.
function recentMessages(messages: BaseMessage[]) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  const start = messages.length - MAX_HISTORY_MESSAGES
  const firstUserMessage = messages.findIndex((m, i) => i >= start && m.getType() === 'human')
  return firstUserMessage === -1 ? messages.slice(start) : messages.slice(firstUserMessage)
}

//   START -> agent --(tool calls?)--> tools -> agent ... -> END
export function buildAdminAgentGraph({ tools, checkpointer, onModelUsage, onModelError }: AdminAgentGraphOptions) {
  // DeepSeek speaks the OpenAI API, so the OpenAI chat model works with a different base URL.
  const model = new ChatOpenAI({
    model: AGENT_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: { baseURL: 'https://api.deepseek.com' },
    temperature: 0,
    maxRetries: 2,
  }).bindTools(tools)

  async function agent(state: typeof MessagesAnnotation.State, config: LangGraphRunnableConfig) {
    const ctx = getAgentContext(config)
    try {
      const response = await model.invoke(
        [new SystemMessage(buildSystemPrompt(ctx.admin)), ...recentMessages(state.messages)],
        config,
      )
      onModelUsage(ctx, {
        promptTokens: response.usage_metadata?.input_tokens ?? 0,
        completionTokens: response.usage_metadata?.output_tokens ?? 0,
      })
      return { messages: [response] }
    } catch (error) {
      onModelError(error)
      throw error
    }
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', agent)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, ['tools', END])
    .addEdge('tools', 'agent')
    .compile({ checkpointer })
}

export type AdminAgentGraph = ReturnType<typeof buildAdminAgentGraph>
