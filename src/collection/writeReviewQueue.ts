import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolvePrivateDataDir } from '../privateData/dataDir.js'
import type { ReviewQueueItem } from '../types.js'

interface WriteOptions {
  dataDir?: string
  env?: NodeJS.ProcessEnv
}

export async function writeReviewQueueItem(reviewItem: ReviewQueueItem, options: WriteOptions = {}): Promise<string> {
  assertReviewItem(reviewItem)

  const dataDir = resolvePrivateDataDir(options.env, { dataDir: options.dataDir })
  const reviewQueueDir = join(dataDir, 'review-queue')
  const outputPath = join(reviewQueueDir, `${reviewItem.id}.json`)
  const record = {
    updatedAt: new Date().toISOString(),
    ...reviewItem,
  }

  await mkdir(reviewQueueDir, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  return outputPath
}

function assertReviewItem(reviewItem: ReviewQueueItem): void {
  if (!reviewItem || typeof reviewItem !== 'object') {
    throw new TypeError('Review queue item must be an object.')
  }

  for (const key of ['id', 'recordType', 'sessionId', 'candidateType', 'candidateId', 'decision']) {
    if (!(key in reviewItem)) {
      throw new TypeError(`Review queue item is missing required field: ${key}`)
    }
  }

  if (reviewItem.recordType !== 'review_queue_item') {
    throw new Error('Review queue item recordType must be review_queue_item.')
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(reviewItem.id)) {
    throw new Error('Review queue item id must be a lowercase slug.')
  }
}
