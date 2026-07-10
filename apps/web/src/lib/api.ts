import {
  GroupListSchema,
  HealthSchema,
  SatelliteListSchema,
  SatelliteSchema,
  type GroupInfo,
  type Health,
  type Satellite,
} from '@orbital-ops/shared'

export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface Parser<T> {
  parse(value: unknown): T
}

async function get<T>(path: string, schema: Parser<T>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`)
  } catch {
    throw new ApiError('API unreachable', null)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(detail, res.status)
  }
  return schema.parse(await res.json())
}

export const api = {
  health: (): Promise<Health> => get('/health', HealthSchema),
  groups: (): Promise<GroupInfo[]> => get('/groups', GroupListSchema),
  satellites: (group: string): Promise<Satellite[]> =>
    get(`/satellites?group=${encodeURIComponent(group)}`, SatelliteListSchema),
  search: (q: string): Promise<Satellite[]> =>
    get(`/satellites/search?q=${encodeURIComponent(q)}`, SatelliteListSchema),
  satellite: (noradId: number): Promise<Satellite> =>
    get(`/satellites/${noradId}`, SatelliteSchema),
}
