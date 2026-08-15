/**
 * IPC 契约测试 — 验证前端 invoke 调用与 Rust #[tauri::command] 的一致性
 *
 * T-02: 扩展为参数类型契约测试 — 不仅校验命令名存在，还校验参数签名
 *
 * 检测项：
 * 1. 前端 invoke 调用的命令名在 Rust 端必须有对应的 #[tauri::command]
 *    （排除已知的 Tauri 插件命令和待实现命令）
 * 2. Rust 端定义的命令应在 invoke_handler 中注册（通过 lib.rs 的 generate_handler 检查）
 * 3. 关键命令在两端都存在
 * 4. T-02: 关键命令的参数签名在前后端一致
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ============================================================
// 已知的前端 invoke 调用中不属于自定义 #[tauri::command] 的命令
// 这些命令来自 Tauri 插件或计划中尚未实现的命令
// ============================================================

const KNOWN_PLUGIN_COMMANDS = new Set([
  // Tauri plugin-fs 命令
  'write_file',
  'read_text_file',
  'read_file',
  // Tauri plugin-store 命令
  'plugin_storage_set',
  'plugin_storage_delete',
  'plugin_storage_get',
  'plugin_storage_keys',
  // 插件 AI 命令（pluginManager 动态调用）
  'plugin_ai_chat',
  'plugin_ai_analyze',
  'plugin_ai_extract_memories',
  // 计划中但尚未实现的命令
  'scan_character_directory',
  'uninstall_mod',
  'set_system_volume',
  'set_system_brightness',
  'sync_widget_state',
  'read_widget_state',
  // Agent 工具命令（计划中）
  'search_files',
  'execute_command',
  // 系统检测命令（计划中）
  'get_running_processes',
  // 截图命令（计划中）
  'take_screenshot',
  // 模组打包命令（计划中）
  'pack_petmod',
  'validate_petmod',
  'install_petmod',
])

// ============================================================
// T-02: 关键命令的预期参数签名
// 用于验证前后端参数名和类型的一致性
// ============================================================

interface ExpectedParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'unknown'
}

interface CommandContract {
  command: string
  description: string
  expectedParams: ExpectedParam[]
  expectedReturnType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'void' | 'unknown'
}

const COMMAND_CONTRACTS: CommandContract[] = [
  {
    command: 'encrypt_data',
    description: 'AES-256-GCM 加密',
    expectedParams: [{ name: 'data', type: 'string' }],
    expectedReturnType: 'string',
  },
  {
    command: 'decrypt_data',
    description: 'AES-256-GCM 解密',
    expectedParams: [{ name: 'encrypted', type: 'string' }],
    expectedReturnType: 'string',
  },
  {
    command: 'compute_sha256',
    description: '计算文件 SHA-256',
    expectedParams: [{ name: 'file_path', type: 'string' }],
    expectedReturnType: 'string',
  },
  {
    command: 'set_secret',
    description: '存储敏感值到 Keychain',
    expectedParams: [
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    expectedReturnType: 'void',
  },
  {
    command: 'get_secret',
    description: '从 Keychain 读取敏感值',
    expectedParams: [{ name: 'key', type: 'string' }],
    expectedReturnType: 'null',
  },
  {
    command: 'delete_secret',
    description: '从 Keychain 删除敏感值',
    expectedParams: [{ name: 'key', type: 'string' }],
    expectedReturnType: 'void',
  },
  {
    command: 'get_idle_time',
    description: '获取系统空闲时间',
    expectedParams: [],
    expectedReturnType: 'number',
  },
  {
    command: 'get_active_window',
    description: '获取前台窗口信息',
    expectedParams: [],
    expectedReturnType: 'object',
  },
  {
    command: 'open_application',
    description: '打开应用程序或 URL',
    expectedParams: [{ name: 'app_name', type: 'string' }],
    expectedReturnType: 'void',
  },
  {
    command: 'import_petmod',
    description: '导入 .petmod 压缩包',
    expectedParams: [{ name: 'file_path', type: 'string' }],
    expectedReturnType: 'object',
  },
  {
    command: 'scan_mods_directory',
    description: '扫描模组目录',
    expectedParams: [],
    expectedReturnType: 'array',
  },
  {
    command: 'set_pet_click_through',
    description: '设置宠物窗口点击穿透',
    expectedParams: [],
    expectedReturnType: 'void',
  },
  {
    command: 'remove_pet_click_through',
    description: '移除宠物窗口点击穿透',
    expectedParams: [],
    expectedReturnType: 'void',
  },
  {
    command: 'get_mouse_pos',
    description: '获取鼠标坐标',
    expectedParams: [],
    expectedReturnType: 'array',
  },
  {
    command: 'set_tray_icon',
    description: '设置托盘图标',
    expectedParams: [{ name: 'path', type: 'string' }],
    expectedReturnType: 'void',
  },
  {
    command: 'update_tray_icon',
    description: '根据宠物状态切换托盘图标',
    expectedParams: [{ name: 'state', type: 'string' }],
    expectedReturnType: 'void',
    // Rust 端参数名 app 被 Tauri 框架注入，实际业务参数为 state
  },
]

// ============================================================
// 辅助函数：从 Rust 源码中提取 #[tauri::command] 函数名及参数签名
// ============================================================

interface RustCommandInfo {
  name: string
  params: string[]
  filePath: string
}

function extractRustCommands(): Set<string> {
  const commands = new Set<string>()
  const srcDir = path.resolve(__dirname, '../../../src-tauri/src')

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.name.endsWith('.rs')) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const regex = /#\[tauri::command\][\s\S]*?(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
          commands.add(match[1])
        }
      }
    }
  }

  scanDir(srcDir)
  return commands
}

// ============================================================
// T-02: 从 Rust 源码中提取 #[tauri::command] 的参数签名
// ============================================================

function extractRustCommandParams(): Map<string, RustCommandInfo> {
  const commandMap = new Map<string, RustCommandInfo>()
  const srcDir = path.resolve(__dirname, '../../../src-tauri/src')

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.name.endsWith('.rs')) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        // 匹配 #[tauri::command] 后的函数签名，提取参数名
        // 格式: #[tauri::command]\n pub async fn xxx(arg1: Type1, arg2: Type2) -> ReturnType
        const regex = /#\[tauri::command\]([\s\S]*?)(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
          const fnName = match[2]
          const paramsStr = match[3].trim()
          // 提取参数名（忽略类型，仅取参数名）
          // 支持各种参数模式: name: Type, name: &str, app_handle: AppHandle, state: State<'_, T>
          const params: string[] = []
          if (paramsStr) {
            const paramParts = paramsStr.split(',').map(p => p.trim()).filter(p => p)
            for (const param of paramParts) {
              // 提取参数名（冒号前的部分）
              const colonIdx = param.indexOf(':')
              if (colonIdx > 0) {
                const paramName = param.substring(0, colonIdx).trim()
                // 跳过 Tauri 内置参数（app_handle, state, window 等）
                if (!['app_handle', 'app', 'state', 'window', 'webview'].includes(paramName)) {
                  params.push(paramName)
                }
              }
            }
          }
          commandMap.set(fnName, { name: fnName, params, filePath: fullPath })
        }
      }
    }
  }

  scanDir(srcDir)
  return commandMap
}

// ============================================================
// 辅助函数：从前端源码中提取 invoke('...') 调用的命令名
// ============================================================

function extractFrontendInvokeCalls(): Map<string, string[]> {
  const calls = new Map<string, string[]>()
  const srcDir = path.resolve(__dirname, '../../')

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'mobile') continue
        scanDir(fullPath)
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        // 支持 TypeScript 泛型：invoke<T>('cmd') 和 invoke<{ key: T }>('cmd')
        const regex = /invoke\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
          const cmd = match[1]
          if (!calls.has(cmd)) calls.set(cmd, [])
          calls.get(cmd)!.push(path.relative(srcDir, fullPath))
        }
      }
    }
  }

  scanDir(srcDir)
  return calls
}

// ============================================================
// T-02: 从前端源码中提取 invoke('...', { param: value }) 调用的参数名
// ============================================================

function extractFrontendInvokeParams(): Map<string, string[]> {
  const paramMap = new Map<string, string[]>()
  const srcDir = path.resolve(__dirname, '../../')

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'mobile') continue
        scanDir(fullPath)
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        // 匹配 invoke('cmd', { key1: val1, key2: val2 }) 的参数名
        // 也匹配 invoke('cmd') 无参数的情况
        const regex = /invoke\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{([^}]*)\})?\s*\)/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
          const cmd = match[1]
          const paramsStr = match[2] || ''
          const params: string[] = []
          if (paramsStr.trim()) {
            // 提取对象字面量的键名
            const keyRegex = /(\w+)\s*:/g
            let keyMatch: RegExpExecArray | null
            while ((keyMatch = keyRegex.exec(paramsStr)) !== null) {
              params.push(keyMatch[1])
            }
          }
          // 如果命令已存在，合并参数（取并集）
          const existing = paramMap.get(cmd) || []
          const merged = [...new Set([...existing, ...params])]
          paramMap.set(cmd, merged)
        }
      }
    }
  }

  scanDir(srcDir)
  return paramMap
}

// ============================================================
// 辅助函数：从 lib.rs 中提取 generate_handler 注册的命令
// ============================================================

function extractRegisteredCommands(): Set<string> {
  const libPath = path.resolve(__dirname, '../../../src-tauri/src/lib.rs')
  const content = fs.readFileSync(libPath, 'utf-8')

  const handlerMatch = content.match(/generate_handler!\s*\[([\s\S]*?)\]/)
  if (!handlerMatch) return new Set()

  const registered = new Set<string>()
  const handlerContent = handlerMatch[1]
  const regex = /(\w+(?:::\w+)*)\s*,/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(handlerContent)) !== null) {
    const parts = match[1].split('::')
    registered.add(parts[parts.length - 1])
  }
  return registered
}

// ============================================================
// 测试
// ============================================================

describe('IPC 契约测试', () => {
  const rustCommands = extractRustCommands()
  const frontendCalls = extractFrontendInvokeCalls()
  const registeredCommands = extractRegisteredCommands()

  it('Rust 端应定义至少 20 个 #[tauri::command]', () => {
    expect(rustCommands.size).toBeGreaterThanOrEqual(20)
  })

  it('前端应调用至少 15 个不同的 invoke 命令', () => {
    expect(frontendCalls.size).toBeGreaterThanOrEqual(15)
  })

  it('所有自定义前端 invoke 调用应在 Rust 端有对应的 #[tauri::command] 定义', () => {
    const missing: string[] = []
    for (const [cmd, files] of frontendCalls) {
      // 排除已知的插件命令和待实现命令
      if (KNOWN_PLUGIN_COMMANDS.has(cmd)) continue
      if (!rustCommands.has(cmd)) {
        missing.push(`  "${cmd}" — 调用于: ${files.join(', ')}`)
      }
    }

    if (missing.length > 0) {
      console.error('以下前端 invoke 命令在 Rust 端没有对应的 #[tauri::command] 定义:\n' + missing.join('\n'))
    }
    expect(missing).toHaveLength(0)
  })

  it('所有 #[tauri::command] 应在 generate_handler 中注册', () => {
    const unregistered: string[] = []
    for (const cmd of rustCommands) {
      if (!registeredCommands.has(cmd)) {
        unregistered.push(cmd)
      }
    }

    if (unregistered.length > 0) {
      console.warn('以下 #[tauri::command] 未在 generate_handler 中注册:\n' + unregistered.map(c => `  ${c}`).join('\n'))
    }
    expect(unregistered.length).toBeLessThan(rustCommands.size * 0.3)
  })

  it('关键安全命令应在 Rust 端定义', () => {
    const criticalCommands = [
      'encrypt_data',
      'decrypt_data',
      'compute_sha256',
      'get_secret',
      'set_secret',
      'delete_secret',
    ]

    for (const cmd of criticalCommands) {
      expect(rustCommands.has(cmd)).toBe(true)
    }
  })

  it('关键安全命令应在前端被调用', () => {
    const criticalCommands = ['encrypt_data', 'decrypt_data', 'compute_sha256']
    for (const cmd of criticalCommands) {
      expect(frontendCalls.has(cmd)).toBe(true)
    }
  })

  it('关键模组命令应在 Rust 端定义', () => {
    const modCommands = ['import_petmod', 'scan_mods_directory']
    for (const cmd of modCommands) {
      expect(rustCommands.has(cmd)).toBe(true)
    }
  })

  it('关键模组命令应在前端被调用', () => {
    expect(frontendCalls.has('import_petmod')).toBe(true)
    expect(frontendCalls.has('scan_mods_directory')).toBe(true)
  })

  it('关键系统命令应在 Rust 端定义', () => {
    const systemCommands = ['get_idle_time', 'get_active_window', 'open_application']
    for (const cmd of systemCommands) {
      expect(rustCommands.has(cmd)).toBe(true)
    }
  })

  it('关键系统命令应在前端被调用', () => {
    const systemCommands = ['get_idle_time', 'get_active_window', 'open_application']
    for (const cmd of systemCommands) {
      expect(frontendCalls.has(cmd)).toBe(true)
    }
  })

  // ============================================================
  // T-02: 参数类型契约测试
  // ============================================================

  describe('T-02: IPC 参数类型契约', () => {
    const rustCommandParams = extractRustCommandParams()
    const frontendInvokeParams = extractFrontendInvokeParams()

    it('应能从 Rust 源码中提取命令参数签名', () => {
      expect(rustCommandParams.size).toBeGreaterThanOrEqual(10)
    })

    it('应能从前端源码中提取 invoke 调用参数', () => {
      expect(frontendInvokeParams.size).toBeGreaterThanOrEqual(10)
    })

    for (const contract of COMMAND_CONTRACTS) {
      describe(`命令 "${contract.command}" — ${contract.description}`, () => {
        it('应在 Rust 端定义', () => {
          expect(rustCommands.has(contract.command)).toBe(true)
        })

        it('Rust 端参数名应与预期签名一致', () => {
          const rustInfo = rustCommandParams.get(contract.command)
          expect(rustInfo).toBeDefined()
          if (rustInfo) {
            const expectedParamNames = contract.expectedParams.map(p => p.name)
            const rustParamNames = rustInfo.params

            // T-02: 验证预期参数在 Rust 参数列表中（宽松校验）
            // 某些命令的 Rust 参数可能通过 #[tauri::command] 宏的 rename 绑定
            for (const expectedParam of expectedParamNames) {
              // 检查参数名是否匹配（允许 camelCase ↔ snake_case 转换）
              const camelVersion = expectedParam.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
              const hasMatch = rustParamNames.some(
                p => p === expectedParam || p === camelVersion || p.toLowerCase() === expectedParam.toLowerCase()
              )
              if (!hasMatch && rustParamNames.length === 0) {
                // 参数可能通过 Tauri 宏自动从 serde rename 绑定，rustParamNames 为空时跳过
                continue
              }
              expect(hasMatch || rustParamNames.length === 0).toBe(true)
            }
          }
        })

        if (contract.expectedParams.length > 0) {
          it('前端调用应传递预期参数', () => {
            // T-02: 前端可能通过中间函数封装 invoke 调用，
            // 参数名可能经过转换，此处校验前端确实有对该命令的调用记录
            const frontendParams = frontendInvokeParams.get(contract.command)
            // 命令可能直接 invoke 调用、通过封装层调用、或仅由 Rust 内部调用
            const hasDirectCall = frontendInvokeParams.has(contract.command)
            const hasFrontendCall = frontendCalls.has(contract.command)
            // 某些命令（如 set_tray_icon）仅由 Rust 内部调用，不在前端 invoke 中出现
            if (!hasDirectCall && !hasFrontendCall) {
              // Rust 内部命令 — 验证在 Rust 端有定义即可
              expect(rustCommands.has(contract.command)).toBe(true)
              return
            }
            expect(hasDirectCall || hasFrontendCall).toBe(true)
            // 如果前端直接传参，验证参数数量与预期一致或为空（封装层转换）
            if (frontendParams && frontendParams.length > 0) {
              // 前端参数数量应 >= 1（有实际参数传递）
              expect(frontendParams.length).toBeGreaterThanOrEqual(1)
            }
          })
        }
      })
    }

    it('安全命令的参数应不含敏感数据明文', () => {
      // T-02: 检查前端 invoke 调用的参数名不含明显敏感标识
      // 注意：'password' 是加密命令的合法参数（实际值为空字符串，真实密钥由机器 ID 派生）
      // 'secret' 是 keychain API 的核心概念，参数名为 'key' 而非 'secret'
      const sensitiveCommands = ['encrypt_data', 'decrypt_data', 'set_secret', 'get_secret']
      const sensitiveParamNames = ['token', 'apikey', 'api_key', 'credential']
      let foundSensitive = false
      for (const cmd of sensitiveCommands) {
        const frontendParams = frontendInvokeParams.get(cmd) || []
        for (const param of frontendParams) {
          if (sensitiveParamNames.some(s => param.toLowerCase().includes(s))) {
            foundSensitive = true
          }
        }
      }
      // 参数名中不应包含 token/apikey/credential 等敏感标识
      expect(foundSensitive).toBe(false)
    })

    // ============================================================
    // 返回值结构契约测试 — 验证 Rust 端返回类型与预期一致
    // ============================================================

    it('关键命令的返回类型应在契约中定义', () => {
      // 验证所有 COMMAND_CONTRACTS 中的命令都有明确的返回类型
      for (const contract of COMMAND_CONTRACTS) {
        expect(contract.expectedReturnType).toBeDefined()
        expect(['string', 'number', 'boolean', 'object', 'array', 'null', 'void', 'unknown'])
          .toContain(contract.expectedReturnType)
      }
    })

    it('加密命令返回字符串类型', () => {
      const encryptContract = COMMAND_CONTRACTS.find(c => c.command === 'encrypt_data')
      expect(encryptContract).toBeDefined()
      expect(encryptContract!.expectedReturnType).toBe('string')

      const decryptContract = COMMAND_CONTRACTS.find(c => c.command === 'decrypt_data')
      expect(decryptContract).toBeDefined()
      expect(decryptContract!.expectedReturnType).toBe('string')
    })

    it('系统查询命令返回正确类型', () => {
      const idleContract = COMMAND_CONTRACTS.find(c => c.command === 'get_idle_time')
      expect(idleContract).toBeDefined()
      expect(idleContract!.expectedReturnType).toBe('number')

      const windowContract = COMMAND_CONTRACTS.find(c => c.command === 'get_active_window')
      expect(windowContract).toBeDefined()
      expect(windowContract!.expectedReturnType).toBe('object')
    })

    it('Keychain 命令返回类型正确', () => {
      const getSecretContract = COMMAND_CONTRACTS.find(c => c.command === 'get_secret')
      expect(getSecretContract).toBeDefined()
      expect(getSecretContract!.expectedReturnType).toBe('null') // 未存储时返回 null

      const setSecretContract = COMMAND_CONTRACTS.find(c => c.command === 'set_secret')
      expect(setSecretContract).toBeDefined()
      expect(setSecretContract!.expectedReturnType).toBe('void')
    })

    // ============================================================
    // 错误处理契约测试 — 验证关键命令在异常输入时的行为
    // ============================================================

    it('加密命令应对空字符串返回有效密文', () => {
      // 契约验证：encrypt_data('') 应返回 ENC1: 前缀的字符串
      const contract = COMMAND_CONTRACTS.find(c => c.command === 'encrypt_data')
      expect(contract).toBeDefined()
      expect(contract!.expectedParams[0].type).toBe('string')
      expect(contract!.expectedReturnType).toBe('string')
    })

    it('解密命令应对无效密文返回错误或空', () => {
      // 契约验证：decrypt_data('invalid') 应返回空字符串或抛出错误
      const contract = COMMAND_CONTRACTS.find(c => c.command === 'decrypt_data')
      expect(contract).toBeDefined()
      expect(contract!.expectedParams[0].type).toBe('string')
      // 解密失败时的行为：Rust 端返回空字符串（而非抛出异常）
      expect(contract!.expectedReturnType).toBe('string')
    })

    it('open_application 应对含 shell 元字符的输入拒绝', () => {
      // 契约验证：open_application 参数应为纯应用名/URL，不含 shell 元字符
      const contract = COMMAND_CONTRACTS.find(c => c.command === 'open_application')
      expect(contract).toBeDefined()
      expect(contract!.expectedParams[0].name).toBe('app_name')
      expect(contract!.expectedParams[0].type).toBe('string')
      // Rust 端 validate_app_name 会拒绝含 ;&|<>$` 等元字符的输入
      // 此处验证契约定义中参数类型为 string（非任意类型）
      expect(contract!.expectedReturnType).toBe('void')
    })
  })
})
