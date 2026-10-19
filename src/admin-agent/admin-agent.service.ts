import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Pool } from 'pg'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { GraphRecursionError } from '@langchain/langgraph'
import { AIMessageChunk, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { CallbackHandler } from '@langfuse/langchain'
import { prisma } from '../lib/prisma'
import { AuditLogService } from '../audit-log/audit-log.service'
import { AiUsageLogService } from '../ai-usage/ai-usage-log.service'
import { RedisService } from '../common/redis/redis.service'
import { MonitoringService } from '../monitoring/monitoring.service'
import { AdminMonitoringService } from '../monitoring/admin-monitoring.service'
import { AdminDashboardService } from '../admin-dashboard/admin-dashboard.service'
import { captureError } from '../monitoring/sentry'
import { AdminAgentGraph, AGENT_MODEL, buildAdminAgentGraph } from './graph/graph'
import { buildAdminAgentTools } from './tools'
import { AgentAdmin } from './tools/define-tool'
import { AdminAgentChatDto } from './dto/admin-agent-chat.dto'

const CHECKPOINT_SCHEMA = 'langgraph'

const RECURSION_LIMIT = 16
const DAILY_MESSAGE_LIMIT = 200
const TITLE_LENGTH = 80

const FAILED_ANSWER = 'Sorry, I could not answer that. Please try again, or ask in a simpler way.'
const TOO_MANY_STEPS_ANSWER =
  'That question needed too many steps. Please ask for one thing at a time, or narrow it down (one user, a shorter date range).'

interface Turn {
  threadId: string
  input: { messages: BaseMessage[] }
  config: Record<string, any>
}

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`
}

@Injectable()
export class AdminAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminAgentService.name)
  private pool?: Pool
  private checkpointer?: PostgresSaver
  private graph?: AdminAgentGraph

  constructor(
    private readonly auditLog: AuditLogService,
    private readonly aiUsageLog: AiUsageLogService,
    private readonly redisService: RedisService,
    private readonly monitoring: MonitoringService,
    private readonly adminMonitoring: AdminMonitoringService,
    private readonly adminDashboard: AdminDashboardService,
  ) {}

  async onModuleInit() {
    try {
      this.pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, max: 3 })
      this.pool.on('error', (err) => this.logger.error(`Checkpoint pool error: ${err.message}`))
      this.checkpointer = new PostgresSaver(this.pool, undefined, { schema: CHECKPOINT_SCHEMA })
      await this.checkpointer.setup()

      this.graph = buildAdminAgentGraph({
        tools: buildAdminAgentTools({
          auditLog: this.auditLog,
          adminMonitoring: this.adminMonitoring,
          adminDashboard: this.adminDashboard,
        }),
        checkpointer: this.checkpointer,
        onModelUsage: ({ admin, threadId }, usage) =>
          this.aiUsageLog.logText({
            userId: admin.id,
            provider: 'DEEPSEEK',
            model: AGENT_MODEL,
            operation: 'CHAT',
            ...usage,
            metadata: { step: 'admin_agent', threadId },
          }),
        onModelError: () => void this.monitoring.recordServiceError('deepseek'),
      })
    } catch (err) {
      this.logger.error(`Admin agent is disabled, checkpointer setup failed: ${(err as Error).message}`)
      captureError(err, 'admin-agent', { step: 'init' })
    }
  }

  async onModuleDestroy() {
    await this.pool?.end().catch(() => undefined)
  }

  async chat(admin: AgentAdmin, dto: AdminAgentChatDto) {
    const turn = await this.prepareTurn(admin, dto)
    const toolsUsed: string[] = []
    let answer: string

    try {
      const result = await this.getGraph().invoke(turn.input, turn.config)
      const messages: BaseMessage[] = result.messages
      const turnStart = messages.findLastIndex((m) => m.getType() === 'human')
      for (const m of messages.slice(turnStart + 1)) {
        for (const call of (m as any).tool_calls ?? []) toolsUsed.push(call.name)
      }
      answer = messages[messages.length - 1]?.text || FAILED_ANSWER
    } catch (err) {
      answer = this.failureAnswer(err, turn.threadId)
    }

    return { threadId: turn.threadId, answer, toolsUsed }
  }

  async *streamTurn(turn: Turn, signal: AbortSignal) {
    yield sse({ type: 'thread', threadId: turn.threadId })

    try {
      const stream = await this.getGraph().stream(turn.input, {
        ...turn.config,
        streamMode: ['messages', 'updates'],
        signal,
      })

      for await (const [mode, payload] of stream as AsyncIterable<[string, any]>) {
        if (mode === 'updates') {
          for (const call of payload?.agent?.messages?.at(-1)?.tool_calls ?? []) {
            yield sse({ type: 'tool', name: call.name })
          }
        } else if (mode === 'messages') {
          const [chunk, metadata] = payload
          if (metadata?.langgraph_node === 'agent' && AIMessageChunk.isInstance(chunk) && chunk.text) {
            yield sse({ type: 'text', text: chunk.text })
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) yield sse({ type: 'error', message: this.failureAnswer(err, turn.threadId) })
    }

    yield 'data: [DONE]\n\n'
  }

  async prepareTurn(admin: AgentAdmin, dto: AdminAgentChatDto): Promise<Turn> {
    this.getGraph()
    await this.assertDailyLimit(admin.id)

    let threadId = dto.threadId
    if (threadId) {
      await this.findOwnThread(admin.id, threadId)
      await prisma.adminAgentThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
    } else {
      const thread = await prisma.adminAgentThread.create({
        data: { adminId: admin.id, title: dto.message.trim().slice(0, TITLE_LENGTH) },
      })
      threadId = thread.id
    }

    return {
      threadId,
      input: { messages: [new HumanMessage(dto.message.trim())] },
      config: {
        configurable: { thread_id: threadId, admin },
        recursionLimit: RECURSION_LIMIT,
        callbacks: [new CallbackHandler({ userId: admin.id, sessionId: threadId, tags: ['admin-agent'] })],
      },
    }
  }

  listThreads(admin: AgentAdmin) {
    return prisma.adminAgentThread.findMany({
      where: { adminId: admin.id },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
  }

  async getThread(admin: AgentAdmin, threadId: string) {
    const thread = await this.findOwnThread(admin.id, threadId)
    const state = await this.getGraph().getState({ configurable: { thread_id: threadId } })
    const messages: BaseMessage[] = state.values?.messages ?? []

    const out: { role: 'user' | 'assistant'; content: string; toolsUsed?: string[] }[] = []
    let pendingTools: string[] = []
    for (const m of messages) {
      const type = m.getType()
      if (type === 'human') {
        out.push({ role: 'user', content: m.text })
      } else if (type === 'ai') {
        pendingTools.push(...((m as any).tool_calls ?? []).map((c: { name: string }) => c.name))
        if (m.text && !(m as any).tool_calls?.length) {
          out.push({ role: 'assistant', content: m.text, toolsUsed: pendingTools })
          pendingTools = []
        }
      }
    }

    return { ...thread, messages: out }
  }

  async deleteThread(admin: AgentAdmin, threadId: string) {
    await this.findOwnThread(admin.id, threadId)
    await this.getCheckpointer().deleteThread(threadId)
    await prisma.adminAgentThread.delete({ where: { id: threadId } })
    return { success: true, id: threadId }
  }

  private getGraph() {
    if (!this.graph) throw new ServiceUnavailableException('The admin assistant is not available right now')
    return this.graph
  }

  private getCheckpointer() {
    if (!this.checkpointer) throw new ServiceUnavailableException('The admin assistant is not available right now')
    return this.checkpointer
  }

  private async findOwnThread(adminId: string, threadId: string) {
    const thread = await prisma.adminAgentThread.findFirst({
      where: { id: threadId, adminId },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
    if (!thread) throw new NotFoundException('Chat not found')
    return thread
  }

  private async assertDailyLimit(adminId: string) {
    const client = this.redisService.getClient()
    const key = `admin-agent:messages:${adminId}:${new Date().toISOString().slice(0, 10)}`
    const count = await client.incr(key)
    if (count === 1) await client.expire(key, 2 * 24 * 60 * 60)
    if (count > DAILY_MESSAGE_LIMIT) {
      throw new HttpException(
        `Daily limit of ${DAILY_MESSAGE_LIMIT} assistant messages reached. Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  private failureAnswer(err: unknown, threadId: string) {
    if (err instanceof GraphRecursionError) return TOO_MANY_STEPS_ANSWER
    this.logger.error(`Admin agent run failed (thread ${threadId}): ${(err as Error)?.message}`)
    captureError(err, 'admin-agent', { threadId })
    return FAILED_ANSWER
  }
}
