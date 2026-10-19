import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { BaseCheckpointSaver, LangGraphRunnableConfig } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { AgentContext, getAgentContext } from '../tools/define-tool'
import { buildSystemPrompt } from './prompt'

export const AGENT_MODEL = 'deepseek-chat'

const MAX_HISTORY_MESSAGES = 10

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

function recentMessages(messages: BaseMessage[]) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  const start = messages.length - MAX_HISTORY_MESSAGES
  const firstUserMessage = messages.findIndex((m, i) => i >= start && m.getType() === 'human')
  const from = firstUserMessage !== -1 ? firstUserMessage : messages.findLastIndex((m) => m.getType() === 'human')
  return messages.slice(Math.max(from, 0))
}

export function buildAdminAgentGraph({ tools, checkpointer, onModelUsage, onModelError }: AdminAgentGraphOptions) {
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
