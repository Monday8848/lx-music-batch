/** 只提供下载引擎用到的部分，避免把整个 react-native 拖进 Node */

export const network = {
  /** wifi | mobile | ethernet | none | unknown */
  type: 'wifi' as string,
}

export const NativeModules = {
  NetworkType: {
    getType: () => network.type,
    isMetered: () => network.type !== 'wifi',
  },
}
