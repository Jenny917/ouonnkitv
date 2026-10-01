import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PUBLIC_ENV_KEYS = [
  'OKI_INITIAL_VIDEO_SOURCES',
  'OKI_TMDB_API_TOKEN',
  'OKI_TMDB_API_BASE_URL',
  'OKI_TMDB_IMAGE_BASE_URL',
  'OKI_ACCESS_PASSWORD',
  'OKI_DISABLE_ANALYTICS',
  'OKI_INITIAL_CONFIG',
]

export function collectRuntimeConfig(environment = process.env) {
  return Object.fromEntries(
    PUBLIC_ENV_KEYS.filter(key => typeof environment[key] === 'string').map(key => [
      key,
      environment[key],
    ]),
  )
}

export function serializeRuntimeConfig(config) {
  const json = JSON.stringify(config)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
  return `globalThis.__OKI_RUNTIME_CONFIG__ = Object.freeze(${json});\n`
}

export async function writeRuntimeConfig(outputPath, environment = process.env) {
  const resolvedOutput = resolve(outputPath)
  const temporaryOutput = `${resolvedOutput}.${process.pid}.tmp`
  await mkdir(dirname(resolvedOutput), { recursive: true })
  await writeFile(
    temporaryOutput,
    serializeRuntimeConfig(collectRuntimeConfig(environment)),
    'utf8',
  )
  await rename(temporaryOutput, resolvedOutput)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  const outputPath = process.argv[2]
  if (!outputPath) {
    console.error('Usage: node scripts/generate-runtime-config.mjs <output-path>')
    process.exitCode = 1
  } else {
    await writeRuntimeConfig(outputPath)
  }
}
