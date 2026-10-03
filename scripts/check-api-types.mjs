import ts from 'typescript'
import { resolve } from 'node:path'

// Model @vercel/node's language-service host, which does not provide realpath.
// Unlike tsc, it resolves declarations through pnpm's public package links.
const cwd = process.cwd()
const configPath = resolve('tsconfig.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, cwd)
const files = ['api/accounts.ts', 'api/account-password.ts', 'api/proxy.ts'].map(file =>
  resolve(file),
)
const service = ts.createLanguageService({
  getScriptFileNames: () => files,
  getScriptVersion: () => '1',
  getScriptSnapshot: file => {
    const content = ts.sys.readFile(file)
    return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
  },
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  getDirectories: ts.sys.getDirectories,
  fileExists: ts.sys.fileExists,
  directoryExists: ts.sys.directoryExists,
  getNewLine: () => ts.sys.newLine,
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  getCurrentDirectory: () => cwd,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
})
const diagnostics = [
  ...parsed.errors,
  ...service.getCompilerOptionsDiagnostics(),
  ...files.flatMap(file => [
    ...service.getSyntacticDiagnostics(file),
    ...service.getSemanticDiagnostics(file),
  ]),
]
service.dispose()
if (diagnostics.length) {
  console.error(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => cwd,
      getNewLine: () => ts.sys.newLine,
    }),
  )
  process.exitCode = 1
} else {
  console.log('API type checks passed with Vercel-style dependency resolution.')
}
