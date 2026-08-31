import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({ HOME: '/home/someone' })).toEqual({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'development',
      isProduction: false,
      imageDir: '/home/someone/Desktop/_stuff/_test/_source',
      dbPath: './data/uatu.db',
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

describe('imageDir', () => {
  it('defaults to the documented source directory under the home directory', () => {
    const config = loadConfig({ HOME: '/home/someone' })

    expect(config.imageDir).toBe('/home/someone/Desktop/_stuff/_test/_source')
  })

  it('expands a leading ~/ in IMAGE_DIR', () => {
    const config = loadConfig({ HOME: '/home/someone', IMAGE_DIR: '~/pictures' })

    expect(config.imageDir).toBe('/home/someone/pictures')
  })

  it('accepts an absolute IMAGE_DIR unchanged', () => {
    const config = loadConfig({ HOME: '/home/someone', IMAGE_DIR: '/srv/images' })

    expect(config.imageDir).toBe('/srv/images')
  })

  it('rejects a relative IMAGE_DIR', () => {
    expect(() => loadConfig({ HOME: '/home/someone', IMAGE_DIR: 'images' })).toThrow(
      /Invalid IMAGE_DIR/,
    )
  })
})

describe('dbPath', () => {
  it('defaults to a data directory beside the working directory', () => {
    expect(loadConfig({ HOME: '/home/someone' }).dbPath).toBe('./data/uatu.db')
  })

  it('honours DB_PATH', () => {
    expect(loadConfig({ HOME: '/home/someone', DB_PATH: '/srv/uatu.db' }).dbPath).toBe(
      '/srv/uatu.db',
    )
  })
})
