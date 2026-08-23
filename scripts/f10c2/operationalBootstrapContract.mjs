/**
 * F10C2 Phase 4B-S — local operational bootstrap contract.
 * Inventory and static rules only. Does not connect to a database.
 */

export const BOOTSTRAP_SLUG = '000_disposable_operational_schema'

export const OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER = [
  'profiles',
  'projects',
  'grids',
  'tasks',
  'task_updates',
  'task_grids',
  'routes',
  'route_grids',
  'cell_files',
  'cell_sites',
  'cell_sectors',
  'task_checklist_items',
  'task_issue_reports',
  'qc_reviews',
]

export const OPERATIONAL_TABLE_DEPENDENCIES = {
  profiles: ['auth.users'],
  projects: ['profiles'],
  grids: ['auth.users'],
  tasks: ['profiles', 'projects', 'grids'],
  task_updates: ['tasks', 'profiles'],
  task_grids: ['tasks', 'grids'],
  routes: ['grids', 'auth.users'],
  route_grids: ['routes', 'grids'],
  cell_files: ['auth.users'],
  cell_sites: ['cell_files'],
  cell_sectors: ['cell_files', 'cell_sites'],
  task_checklist_items: ['tasks', 'auth.users'],
  task_issue_reports: ['tasks', 'auth.users'],
  qc_reviews: ['tasks', 'grids', 'profiles'],
}

export const REQUIRED_APP_COLUMNS = {
  profiles: ['id', 'email', 'role', 'created_at', 'full_name', 'is_active'],
  projects: [
    'id', 'name', 'customer', 'market', 'testing_type', 'start_date',
    'status', 'created_by', 'created_at',
  ],
  grids: ['id', 'name', 'market', 'grid_id', 'geometry', 'created_by', 'created_at', 'status'],
  tasks: [
    'id', 'title', 'description', 'type', 'assigned_to', 'status', 'created_at',
    'started_at', 'completed_at', 'project', 'market', 'target_type', 'target_name',
    'priority', 'due_date', 'notes', 'test_type', 'project_id', 'grid_id',
  ],
  task_updates: [
    'id', 'task_id', 'user_id', 'comment', 'photo_url', 'created_at',
    'latitude', 'longitude', 'user_email',
  ],
  task_grids: ['id', 'task_id', 'grid_id', 'created_at'],
  routes: [
    'id', 'name', 'grid_id', 'geometry', 'route_type', 'created_by', 'created_at',
    'market', 'status', 'route_name', 'route_mode', 'route_geojson',
    'route_length_m', 'route_source', 'generated_at',
  ],
  route_grids: ['id', 'route_id', 'grid_id', 'created_at'],
  cell_files: [
    'id', 'file_name', 'market', 'technology', 'record_count',
    'uploaded_by', 'created_at', 'updated_at',
  ],
  cell_sites: [
    'id', 'site_name', 'cell_name', 'latitude', 'longitude', 'azimuth',
    'technology', 'pci', 'earfcn', 'market', 'created_at', 'cell_file_id',
    'lat', 'lon',
  ],
  cell_sectors: [
    'id', 'cell_file_id', 'site_id', 'market', 'system', 'technology',
    'site_name', 'cell_name', 'cid', 'lat', 'lon', 'azimuth', 'antenna_bw',
    'lac', 'mcc', 'mnc', 'earfcn', 'pci', 'raw_row', 'created_at',
  ],
  task_checklist_items: [
    'id', 'task_id', 'label', 'item_order', 'is_done', 'completed_at',
    'completed_by', 'created_at', 'updated_at',
  ],
  task_issue_reports: [
    'id', 'task_id', 'issue_type', 'severity', 'description', 'status',
    'lat', 'lon', 'reported_by', 'created_at', 'updated_at',
  ],
  qc_reviews: [
    'id', 'task_id', 'grid_id', 'reviewer_id', 'log_received', 'log_naming_correct',
    'required_evidence_received', 'checklist_reviewed', 'issues_reviewed',
    'notes_photos_reviewed', 'qc_decision', 'qc_notes', 'redrive_needed',
    'redrive_reason', 'redrive_task_id', 'reviewed_at', 'created_at', 'updated_at',
  ],
}

export const EXCLUDED_MIGRATIONS = [
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
  '112_result_artifacts_storage_contract',
]

export const NEVER_EXECUTE = ['207_rls_tenant_storage_assumptions']

export const FINAL_EXECUTION_ORDER = [
  { step: 0, title: 'JavaScript disposable target guard' },
  { step: 1, title: 'SQL disposable transaction marker (SET LOCAL after JS guard + SQL approval)' },
  { step: 2, title: 'Operational schema bootstrap 000' },
  { step: 3, title: 'F10C1I: 001–008, 011, 014–020' },
  { step: 4, title: 'F10C2: 101–111, 113–115' },
  { step: 5, title: 'Phase 4A-R1: 201–206' },
  { step: 6, title: 'Create synthetic Auth users' },
  { step: 7, title: 'Insert synthetic profiles/project/grid/task' },
  { step: 8, title: 'Apply synthetic field-result fixtures 301' },
  { step: 9, title: 'Run relational/RPC/storage/QC verification' },
  { step: 10, title: 'Produce evidence' },
  { step: 11, title: 'Stop before cleanup' },
]
