import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'development',
      isProduction: false,
    })
  })

  it('reads values from the environment', () => {
    const config = loadConfig({ PORT: '8080', HOST: '127.0.0.1', NODE_ENV: 'production' })

    expect(config.port).toBe(8080)
    expect(config.host).toBe('127.0.0.1')
    expect(config.isProduction).toBe(true)
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/)
  })

  it('rejects an out-of-range PORT', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/)
  })

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid NODE_ENV/)
  })
})
