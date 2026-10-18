import { useAuthStore } from '@/stores/auth-store'

const DB_NAME = 'newapi-playground-assets'
const STORE = 'assets'
function assetKey(session: string, id: string): string {
  const userId = useAuthStore.getState().auth.user?.id
  if (userId == null) throw new Error('A signed-in account is required')
  return `${userId}:${session}:${id}`
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.addEventListener('upgradeneeded', () =>
      request.result.createObjectStore(STORE)
    )
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () =>
      reject(new Error('Unable to open attachment storage'))
    )
  })
}
export async function saveAsset(
  session: string,
  id: string,
  blob: Blob
): Promise<void> {
  const key = assetKey(session, id)
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(blob, key)
      transaction.addEventListener('complete', () => resolve())
      const onFailure = () =>
        reject(
          new Error('Unable to save attachment. Browser storage may be full.')
        )
      transaction.addEventListener('error', onFailure)
      transaction.addEventListener('abort', onFailure)
    })
  } finally {
    database.close()
  }
}
export async function loadAsset(
  session: string,
  id: string
): Promise<Blob | undefined> {
  const key = assetKey(session, id)
  const database = await openDatabase()
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(key)
      request.addEventListener('success', () =>
        resolve(request.result instanceof Blob ? request.result : undefined)
      )
      request.addEventListener('error', () =>
        reject(new Error('Unable to read attachment'))
      )
    })
  } finally {
    database.close()
  }
}
export async function deleteSessionAssets(session: string): Promise<void> {
  const prefix = assetKey(session, '')
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      const request = transaction
        .objectStore(STORE)
        .openCursor(IDBKeyRange.bound(prefix, `${prefix}￿`))
      request.addEventListener('success', () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      })
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () =>
        reject(new Error('Unable to remove attachments'))
      )
    })
  } finally {
    database.close()
  }
}
export function blobDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () =>
      reject(new Error('Unable to read attachment'))
    )
    reader.readAsDataURL(blob)
  })
}
