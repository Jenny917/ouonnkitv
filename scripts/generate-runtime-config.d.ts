export const PUBLIC_ENV_KEYS: string[]

export function collectRuntimeConfig(
  environment?: Record<string, string | undefined>,
): Record<string, string>

export function serializeRuntimeConfig(config: Record<string, string>): string

export function writeRuntimeConfig(
  outputPath: string,
  environment?: Record<string, string | undefined>,
): Promise<void>
