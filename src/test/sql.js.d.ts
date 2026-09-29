declare module 'sql.js' {
  /** sql.js 的标量绑定值 / 结果单元格值 */
  export type SqlValue = string | number | Uint8Array | null | boolean

  /** exec() 单次查询的返回块：列名 + 行数组 */
  export interface QueryResult {
    columns: string[]
    values: SqlValue[][]
  }

  export interface Database {
    run(sql: string, params?: SqlValue[]): void
    exec(sql: string, params?: SqlValue[]): QueryResult[]
    close(): void
    export(): Uint8Array
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database
  }

  /** 初始化配置：本项目只用 wasm 文件定位 */
  export interface InitSqlJsConfig {
    locateFile?: (path: string) => string
  }

  export function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>
  export default { initSqlJs }
}
