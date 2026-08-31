export type NodeEnv = 'development' | 'production' | 'test'

export interface Config {
  readonly port: number
  readonly host: string
  readonly nodeEnv: NodeEnv
  readonly isProduction: boolean
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test']

/**
 * Kept pure and exported separately from `config` so it can be tested directly
 * against a fabricated environment.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const nodeEnv = parseNodeEnv(env.NODE_ENV)

  return {
    port: parsePort(env.PORT),
    host: env.HOST ?? '0.0.0.0',
    nodeEnv,
    isProduction: nodeEnv === 'production',
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return 3000
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: expected an integer in 1-65535, got ${JSON.stringify(raw)}`)
  }
  return port
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined || raw === '') {
    return 'development'
  }
  if (!NODE_ENVS.includes(raw as NodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV: expected one of ${NODE_ENVS.join(', ')}, got ${JSON.stringify(raw)}`,
    )
  }
  return raw as NodeEnv
}

/**
 * Validated once at import time, so a misconfigured deploy fails at startup rather
 * than on the first request that happens to touch the bad value.
 */
export const config = loadConfig(process.env)
