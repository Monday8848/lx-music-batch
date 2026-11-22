import * as esbuild from 'esbuild'
import path from 'node:path'

const root = process.cwd()
const mock = (name) => path.join(root, 'test', 'mocks', name)

await esbuild.build({
  entryPoints: [path.join(root, 'test', 'version-guard.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(root, 'test', 'version-guard.mjs'),
  logLevel: 'error',
  alias: {
    '@/navigation': mock('navigation.ts'),
    '@/utils/data': mock('versionData.ts'),
    'react-native-navigation': mock('rnn.ts'),
  },
})
