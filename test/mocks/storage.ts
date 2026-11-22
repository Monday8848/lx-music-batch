const store = new Map<string, any>()

export const saveData = async(key: string, value: any) => {
  store.set(key, JSON.parse(JSON.stringify(value)))
}

export const getData = async<T>(key: string): Promise<T | null> => {
  return (store.get(key) as T) ?? null
}
