export interface Task {
  id: string
  list_id: string
  title: string
  description?: string
  location?: string
  geo?: string
  url?: string
  organizer?: string
  priority: number
  classification?: number
  completed?: string
  completed_is_allday: number
  percent_complete?: number
  status: number
  task_color?: string
  dtstart?: string
  is_allday: number
  created: string
  last_modified: string
  tz?: string
  due?: string
  duration?: string
  rdate?: string
  exdate?: string
  rrule?: string
  original_instance_sync_id?: string
  original_instance_id?: number
  original_instance_time?: string
  original_instance_allday: number
  parent_id?: number
  sorting?: string
  has_alarms: number
  has_properties: number
  pinned: number
  version: number
  _uid?: string
  _deleted: number
  _dirty: number
  list_name?: string
  list_color?: string
  properties?: Property[]
  children?: Task[]
}

export interface TaskList {
  id: string
  name: string
  color: string
  account_name: string
  account_type: string
  visible: number
  sync_enabled: number
  owner?: string
  access_level: number
  created_at: string
  updated_at: string
}

export interface Category {
  id: number
  name: string
  color: string
  account_name: string
  account_type: string
  created_at: string
}

export interface Property {
  id: number
  task_id: number
  mimetype: string
  version: number
  data0?: string
  data1?: string
  data2?: string
  data3?: string
  data4?: string
  data5?: string
  data6?: string
  data7?: string
  data8?: string
  data9?: string
  data10?: string
  data11?: string
  data12?: string
  data13?: string
  data14?: string
  data15?: string
}

export interface TaskFilters {
  list_id?: string
  status?: number
  priority?: number
  due_after?: string
  due_before?: string
  search?: string
  limit?: number
  offset?: number
}

export interface PaginationInfo {
  total: number
  limit: number
  offset: number
  pages: number
}

export interface TasksResponse {
  tasks: Task[]
  pagination: PaginationInfo
}

export interface ApiError {
  error: string
  details?: string[]
}