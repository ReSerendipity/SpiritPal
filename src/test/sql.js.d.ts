declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): void
    exec(sql: string, params?: any[]): any[]
    close(): void
    export(): Uint8Array
  }

  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database
  }

  export function initSqlJs(config?: any): Promise<SqlJsStatic>
  export default { initSqlJs }
}
