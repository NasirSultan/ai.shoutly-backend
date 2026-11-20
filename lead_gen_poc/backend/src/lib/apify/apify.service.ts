import { Injectable, Logger } from '@nestjs/common'
import { ApifyClient } from 'apify-client'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as path from 'path'

export interface ActorRunResult {
  items: Record<string, any>[]
  /** Apify's status message: actors report quota problems here, with an empty dataset */
  statusMessage: string
}

const SAMPLES_DIR = path.join(process.cwd(), 'samples')

// Thin wrapper over apify-client. Platform-specific input/output mapping lives
// in the lead finder's sources, not here, so this can be shared later.
@Injectable()
export class ApifyService {
  private readonly logger = new Logger(ApifyService.name)
  private client?: ApifyClient

  /** APIFY_MOCK=true: read samples/<name>.json instead of running actors (no credits). */
  get isMock() {
    return process.env.APIFY_MOCK === 'true'
  }

  private getClient() {
    if (!this.client) {
      const token = process.env.APIFY_TOKEN
      if (!token) throw new Error('APIFY_TOKEN is not set')
      this.client = new ApifyClient({ token })
    }
    return this.client
  }

  async runActor(
    actorId: string,
    input: Record<string, unknown>,
    limit: number,
  ): Promise<ActorRunResult> {
    const client = this.getClient()
    this.logger.log(`Running ${actorId} ${JSON.stringify(input)}`)
    const run = await client.actor(actorId).call(input, { timeout: 180 })
    const { items } = await client
      .dataset<Record<string, any>>(run.defaultDatasetId)
      .listItems({ limit })
    const statusMessage = run.statusMessage ?? run.status
    this.logger.log(`Run ${run.id} finished with ${items.length} items (${statusMessage})`)
    return { items, statusMessage }
  }

  readSample(name: string): Record<string, any>[] {
    const file = path.join(SAMPLES_DIR, `${name}.json`)
    if (!existsSync(file)) throw new Error(`APIFY_MOCK is on but ${file} does not exist`)
    this.logger.warn(`APIFY_MOCK — serving ${file}`)
    return JSON.parse(readFileSync(file, 'utf8'))
  }

  /** Dev helper: APIFY_SAVE_SAMPLES=true keeps the last real run as a mock sample. */
  saveSample(name: string, items: Record<string, any>[]) {
    if (process.env.APIFY_SAVE_SAMPLES !== 'true' || items.length === 0) return
    mkdirSync(SAMPLES_DIR, { recursive: true })
    writeFileSync(path.join(SAMPLES_DIR, `${name}.json`), JSON.stringify(items, null, 2))
  }
}
