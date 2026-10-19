import { tool } from '@langchain/core/tools'
import type { RunnableConfig } from '@langchain/core/runnables'
import { z } from 'zod'
import { AuditLogService } from '../../audit-log/audit-log.service'

export interface AgentAdmin {
  id: string
  email: string
}

export interface AgentContext {
  admin: AgentAdmin
  threadId: string
}

export function getAgentContext(config?: RunnableConfig): AgentContext {
  const admin = config?.configurable?.admin as AgentAdmin | undefined
  const threadId = config?.configurable?.thread_id as string | undefined
  if (!admin || !threadId) throw new Error('Admin agent run is missing its admin or thread id')
  return { admin, threadId }
}

const MAX_RESULT_CHARS = 12_000

export interface ToolDefinition<S extends z.ZodObject<any>> {
  name: string
  description: string
  schema: S
  run: (input: z.infer<S>, ctx: AgentContext) => Promise<unknown>
}

export function defineTool<S extends z.ZodObject<any>>(auditLog: AuditLogService, def: ToolDefinition<S>) {
  return tool(
    async (input: z.infer<S>, config?: RunnableConfig) => {
      const ctx = getAgentContext(config)
      auditLog.log({
        actor: ctx.admin,
        action: 'ADMIN_AGENT_TOOL_CALLED',
        targetType: 'AdminAgentThread',
        targetId: ctx.threadId,
        after: { tool: def.name, input },
      })

      const text = JSON.stringify((await def.run(input, ctx)) ?? null)
      return text.length > MAX_RESULT_CHARS
        ? `${text.slice(0, MAX_RESULT_CHARS)}... (result cut off: use a narrower filter or a smaller limit)`
        : text
    },
    { name: def.name, description: def.description, schema: def.schema },
  )
}
