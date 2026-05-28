import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

export interface PrivacyScanFinding {
  file: string
  rule: string
  message: string
}

export interface PrivacyScanResult {
  filesScanned: number
  findings: PrivacyScanFinding[]
}

interface PatternRule {
  rule: string
  message: string
  pattern: RegExp
}

const PRIVATE_PATH_PREFIXES = [
  'data/',
  'private/',
  'crm/',
  'drafts/',
  'evidence/',
  'screenshots/',
  'raw-pages/',
  'browser-profile/',
  'memory-bank/',
]

const PRIVATE_EXTENSIONS = new Set([
  '.docx',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
])

const CONTENT_RULES: PatternRule[] = [
  {
    rule: 'secret-openai-key',
    message: 'tracked content contains an OpenAI-style API key',
    pattern: /\bsk-[\w-]{20,}\b/,
  },
  {
    rule: 'secret-github-token',
    message: 'tracked content contains a GitHub token-like value',
    pattern: /\bgh[pousr]_\w{30,}\b/,
  },
  {
    rule: 'secret-aws-access-key',
    message: 'tracked content contains an AWS access key-like value',
    pattern: /\bAKIA[\dA-Z]{16}\b/,
  },
  {
    rule: 'secret-private-key',
    message: 'tracked content contains a private key header',
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  },
  {
    rule: 'personal-email',
    message: 'tracked content contains an email address',
    pattern: /\b[\w.%+-]+@[\w.-]+\.[A-Z]{2,}\b/i,
  },
  {
    rule: 'local-windows-user-path',
    message: 'tracked content contains a local Windows user path',
    pattern: /\b[A-Za-z]:\\Users\\[^"'`\s]+/,
  },
  {
    rule: 'local-posix-user-path',
    message: 'tracked content contains a local user home path',
    pattern: /(?:^|[\s"'`])(?:\/Users|\/home)\/[^"'`\s]+/,
  },
]

export async function runPrivacyScan(rootDir: string): Promise<PrivacyScanResult> {
  const files = listTrackedFiles(rootDir)
  const findings: PrivacyScanFinding[] = []

  for (const file of files) {
    findings.push(...scanPath(file))

    const content = await readTrackedTextFile(rootDir, file)
    if (content !== null) {
      findings.push(...scanPrivacyContent(file, content))
    }
  }

  return {
    filesScanned: files.length,
    findings,
  }
}

export function scanPrivacyContent(file: string, content: string): PrivacyScanFinding[] {
  const findings: PrivacyScanFinding[] = []

  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(content)) {
      findings.push({
        file,
        rule: rule.rule,
        message: rule.message,
      })
    }
  }

  return findings
}

function scanPath(file: string): PrivacyScanFinding[] {
  const normalized = file.replaceAll('\\', '/')
  const findings: PrivacyScanFinding[] = []

  if (PRIVATE_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    findings.push({
      file,
      rule: 'private-path-tracked',
      message: 'tracked file lives under a private-data path',
    })
  }

  if (PRIVATE_EXTENSIONS.has(extname(normalized).toLowerCase())) {
    findings.push({
      file,
      rule: 'private-asset-tracked',
      message: 'tracked file has a private asset extension',
    })
  }

  return findings
}

function listTrackedFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'buffer',
  })

  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim()
    throw new Error(`Failed to list tracked files.${stderr ? ` ${stderr}` : ''}`)
  }

  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(file => file.replaceAll('\\', '/'))
}

async function readTrackedTextFile(rootDir: string, file: string): Promise<string | null> {
  try {
    return await readFile(join(rootDir, file), 'utf8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}
