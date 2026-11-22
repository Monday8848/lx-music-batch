import * as esbuild from 'esbuild'
import path from 'node:path'

const root = process.cwd()
const mock = (name) => path.join(root, 'test', 'mocks', name)

await esbuild.build({
  entryPoints: [path.join(root, 'test', 'harness.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(root, 'test', 'out.mjs'),
  logLevel: 'info',
  alias: {
    '@/core/music': mock('coreMusic.ts'),
    '@/core/music/utils': mock('musicUtils.ts'),
    '@/plugins/storage': mock('storage.ts'),
    '@/store/setting/state': mock('settingState.ts'),
    '@/utils/log': mock('log.ts'),
    '@/utils/fs': mock('fs.ts'),
    '@/utils/localMediaMetadata': mock('metadata.ts'),
    '@/utils/tools': mock('tools.ts'),
    'react-native-fs': mock('rnfs.ts'),
    'react-native': mock('reactNative.ts'),
  },
})
