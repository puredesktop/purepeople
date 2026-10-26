import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'

// Development may inspect a dirty tree. Delivery must use --require-clean.
const options = { requireClean: false, expectedHead: null, output: null }
const args = process.argv.slice(2)
while (args.length) {
  const arg = args.shift()
  if (arg === '--require-clean') options.requireClean = true
  else if (arg === '--expected-head' || arg === '--output') {
    const value = args.shift()
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    options[arg === '--expected-head' ? 'expectedHead' : 'output'] = value
  } else throw new Error(`Unknown argument: ${arg}`)
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}
const hash = value => createHash('sha256').update(value).digest('hex')
function snapshot() {
  const paths = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort()
  const files = paths.map(path => {
    try {
      const stat = lstatSync(path)
      return { path, mode: stat.mode & 0o777, sha256: hash(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path)) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return { path, deleted: true }
    }
  })
  return {
    headSha: git('rev-parse', 'HEAD'),
    treeSha: git('rev-parse', 'HEAD^{tree}'),
    workingTreeDirty: Boolean(git('status', '--porcelain', '--untracked-files=all')),
    sourceSha256: hash(JSON.stringify(files)),
  }
}
const before = snapshot()
const report = {
  ...before,
  expectedHeadSha: options.expectedHead,
  verifiedHeadSha: null,
  checksPassed: false,
  sourcesUnchanged: false,
  changedFiles: [...new Set([
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
    ...(!before.workingTreeDirty ? git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n') : []),
  ].filter(Boolean))].sort(),
  commands: [],
  errors: [],
}
if (options.output) {
  const ignored = spawnSync('git', ['check-ignore', '--quiet', options.output])
  if (ignored.status !== 0) report.errors.push('Report output must be git-ignored so saving it cannot change the verified source.')
}
if (options.requireClean && before.workingTreeDirty) {
  report.errors.push('Delivery verification requires committed changes. Have PureDev commit the prepared tree, then rerun npm run verify.')
}
if (options.expectedHead && before.headSha !== options.expectedHead) {
  report.errors.push(`Expected head ${options.expectedHead}, found ${before.headSha}.`)
}
const commands = [
  ['git', ['diff', '--check']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'test', '--', 'src/lib/customers.test.ts', 'src/hooks/usePeopleData.test.tsx', 'src/components/customers/CustomerView.test.tsx']],
  ['npm', ['run', 'test']],
  ['npm', ['run', 'build']],
]
if (!report.errors.length) {
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const summary = output.split('\n').filter(line => /Test Files|Tests  |✓ built in|Some chunks/.test(line)).join('\n').trim()
    report.commands.push({ command: [command, ...args].join(' '), exitCode: result.status, summary, ...(result.status !== 0 ? { output, error: result.error?.message } : {}) })
    if (result.status !== 0) break
  }
  report.checksPassed = report.commands.length === commands.length && report.commands.every(result => result.exitCode === 0)
}
const after = snapshot()
report.sourcesUnchanged = JSON.stringify(before) === JSON.stringify(after)
if (!report.sourcesUnchanged) report.errors.push('Source files or HEAD changed during verification. Rerun on the final tree.')
if (report.checksPassed && report.sourcesUnchanged && !before.workingTreeDirty && !report.errors.length) {
  report.verifiedHeadSha = before.headSha
}
const serialized = JSON.stringify(report, null, 2) + '\n'
if (options.output && !report.errors.some(message => message.startsWith('Report output'))) {
  mkdirSync(dirname(resolve(options.output)), { recursive: true })
  writeFileSync(options.output, serialized)
}
console.log(serialized.trimEnd())
if (report.errors.length || !report.checksPassed || (options.requireClean && !report.verifiedHeadSha)) process.exitCode = 1
