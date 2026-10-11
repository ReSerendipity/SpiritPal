/**
 * @file ipcCommands.ts
 * @description Tauri command 名常量表 —— 收敛散落在各调用点的 Magic String（评估报告 P0-1）
 *
 * 用途：
 * - 所有 Tauri invoke 调用统一引用本表常量，避免命令名拼写错误/改名遗漏
 * - 与 src/lib/__tests__/ipcContract.test.ts 的契约测试配合：该测试扫描
 *   invoke / tauriInvoke / tauriInvokeNoRetry 三种调用形式并校验 Rust 端存在性
 *
 * 分类约定：
 * - DB_*：Rust 语义化 SQLite 命令（sp_*）
 * - SYS_*：系统命令（加密/窗口/音量/托盘等）
 * - 动态命令（cmd / cmd_pet_hug）与长耗时命令（take_screenshot / ondevice_* /
 *   start_device_listening 等）保留直连 invoke，不经 tauriInvoke 30s 超时包装——
 *   见执行对照表 P0-1 决策留痕
 */
export const IPC = {
  // ============ 数据库语义命令（sp_*，Rust sqlite.rs） ============
  DB_MIGRATE: 'sp_db_migrate',
  DB_PURGE: 'sp_db_purge',
  DB_CHAR_LIST: 'sp_char_list',
  DB_CHAR_SAVE_STATS: 'sp_char_save_stats',
  DB_MEM_LIST: 'sp_mem_list',
  DB_MEM_BY_CHARACTER: 'sp_mem_by_character',
  DB_MEM_BY_TIER: 'sp_mem_by_tier',
  DB_MEM_DELETE: 'sp_mem_delete',
  DB_MEM_CLEAR: 'sp_mem_clear',
  DB_MEM_CLEAR_ALL: 'sp_mem_clear_all',
  DB_MEM_UPDATE_ROW: 'sp_mem_update_row',
  DB_MEM_TOUCH: 'sp_mem_touch',
  DB_MEM_SAVE_EMBEDDING: 'sp_mem_save_embedding',
  DB_MEM_SAVE_EMBEDDINGS_BATCH: 'sp_mem_save_embeddings_batch',
  DB_MEM_STATE_UPSERT: 'sp_mem_state_upsert',
  DB_MEM_STATE_DELETE: 'sp_mem_state_delete',
  DB_MEM_SUMMARY_UPSERT: 'sp_mem_summary_upsert',
  DB_MEM_SUMMARY_DELETE: 'sp_mem_summary_delete',
  DB_OWNER_FACTS_UPSERT: 'sp_owner_facts_upsert',
  DB_OWNER_FACTS_DELETE: 'sp_owner_facts_delete',
  DB_OWNER_FACTS_CLEAR: 'sp_owner_facts_clear',
  DB_OWNER_FACTS_LIST: 'sp_owner_facts_list',
  DB_OWNER_FACTS_AS_OF: 'sp_owner_facts_as_of',
  DB_OWNER_FACTS_HISTORY: 'sp_owner_facts_history',
  DB_SEM_FACTS_UPSERT: 'sp_sem_facts_upsert',
  DB_SEM_FACTS_DELETE: 'sp_sem_facts_delete',
  DB_SEM_FACTS_CLEAR: 'sp_sem_facts_clear',
  DB_SEM_FACTS_LIST: 'sp_sem_facts_list',
  DB_SEM_FACTS_BY_KEY: 'sp_sem_facts_by_key',
  DB_ENTITY_UPSERT: 'sp_entity_upsert',
  DB_ENTITY_CLEAR: 'sp_entity_clear',
  DB_ENTITY_LIST: 'sp_entity_list',
  DB_ENTITYGRAPH_UPSERT_EDGE: 'sp_entitygraph_upsert_edge',
  DB_INVENTORY_LIST: 'sp_inventory_list',
  DB_INVENTORY_SAVE: 'sp_inventory_save',
  DB_MODS_LIST: 'sp_mods_list',
  DB_MODS_SAVE: 'sp_mods_save',
  DB_MODS_DELETE: 'sp_mods_delete',
  DB_MODS_SET_ENABLED: 'sp_mods_set_enabled',
  DB_SCHEDULES_LIST: 'sp_schedules_list',
  DB_SCHEDULES_SAVE: 'sp_schedules_save',
  DB_SCHEDULES_DELETE: 'sp_schedules_delete',
  DB_COMMITMENTS_SET_STATUS: 'sp_commitments_set_status',
  DB_COMMITMENTS_INCREMENT_FOLLOW_UP: 'sp_commitments_increment_follow_up',
  DB_SETTINGS_SET: 'sp_settings_set',
  DB_SETTINGS_REMOVE: 'sp_settings_remove',
  DB_PET_EXP_LIST: 'sp_pet_exp_list',
  DB_PET_EXP_INSERT: 'sp_pet_exp_insert',
  DB_PET_EXP_CLEAR: 'sp_pet_exp_clear',
  DB_VISUAL_LIST: 'sp_visual_list',
  DB_VISUAL_INSERT: 'sp_visual_insert',
  DB_VISUAL_CLEAR: 'sp_visual_clear',
  DB_DIRTY_UPSERT: 'sp_dirty_upsert',
  DB_DIRTY_RESOLVE: 'sp_dirty_resolve',
  DB_SCHEMA_VERSION_RECORD: 'sp_schema_version_record',
  DB_SCHEMA_LOG_FAILURE: 'sp_schema_log_failure',
  DB_SCHEMA_RESOLVE_FAILURE: 'sp_schema_resolve_failure',
  DB_CTX_CLOSE: 'sp_ctx_close',

  // ============ 系统命令（加密/窗口/音量/托盘/文件等） ============
  ENCRYPT_DATA: 'encrypt_data',
  DECRYPT_DATA: 'decrypt_data',
  ENCRYPT_DB_AT_REST: 'encrypt_db_at_rest',
  DECRYPT_DB_AT_REST: 'decrypt_db_at_rest',
  SET_SECRET: 'set_secret',
  DELETE_SECRET: 'delete_secret',
  SHOW_PET_WINDOW: 'show_pet_window',
  HIDE_PET_WINDOW: 'hide_pet_window',
  SET_PET_ALWAYS_ON_TOP: 'set_pet_always_on_top',
  SET_PET_CLICK_THROUGH: 'set_pet_click_through',
  REMOVE_PET_CLICK_THROUGH: 'remove_pet_click_through',
  SET_TRAY_ICON: 'set_tray_icon',
  SET_TRAY_ICON_PNG: 'set_tray_icon_png',
  UPDATE_TRAY_ICON: 'update_tray_icon',
  SET_SYSTEM_VOLUME: 'set_system_volume',
  SET_SYSTEM_BRIGHTNESS: 'set_system_brightness',
  OPEN_APPLICATION: 'open_application',
  OPEN_PATH: 'open_path',
  READ_TEXT_FILE: 'read_text_file',
  WRITE_FILE: 'write_file',
  SCAN_CHARACTER_DIRECTORY: 'scan_character_directory',
  SYNC_WIDGET_STATE: 'sync_widget_state',
  AUDIT_LOG: 'audit_log',
  LOG_FRONTEND_ERROR: 'log_frontend_error',
  BACKUP_DB_AT_REST: 'backup_db_at_rest',
  RESTORE_DB_BACKUP: 'restore_db_backup',
  DELETE_DB_BACKUP: 'delete_db_backup',
  UNINSTALL_MOD: 'uninstall_mod',
} as const

export type IpcCommandName = (typeof IPC)[keyof typeof IPC]
