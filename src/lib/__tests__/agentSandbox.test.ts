// AI Agent 安全沙箱单元测试 — 权限校验与审计
// P3-24: 安全沙箱+权限控制
import { describe, it, expect, beforeEach } from 'vitest'
import { AgentSandbox, getAgentSandbox } from '../agentSandbox'
import { ToolMode } from '../agentTools'

// ============ 测试 ============

describe('AgentSandbox', () => {
  let sandbox: AgentSandbox

  beforeEach(() => {
    sandbox = new AgentSandbox()
  })

  describe('默认权限', () => {
    it('低风险权限默认授予', () => {
      expect(sandbox.getPermissionStatus('web_search')).toBe('granted')
      expect(sandbox.getPermissionStatus('pet_control')).toBe('granted')
      expect(sandbox.getPermissionStatus('weather_access')).toBe('granted')
      expect(sandbox.getPermissionStatus('schedule_access')).toBe('granted')
    })

    it('高风险权限默认拒绝', () => {
      expect(sandbox.getPermissionStatus('open_app')).toBe('denied')
      expect(sandbox.getPermissionStatus('read_files')).toBe('denied')
      expect(sandbox.getPermissionStatus('write_files')).toBe('denied')
      expect(sandbox.getPermissionStatus('execute_command')).toBe('denied')
    })
  })

  describe('权限管理', () => {
    it('授予权限', () => {
      sandbox.grantPermission('open_app')
      expect(sandbox.getPermissionStatus('open_app')).toBe('granted')
    })

    it('拒绝权限', () => {
      sandbox.denyPermission('web_search')
      expect(sandbox.getPermissionStatus('web_search')).toBe('denied')
    })

    it('重置权限', () => {
      sandbox.grantPermission('execute_command')
      sandbox.resetPermissions()
      expect(sandbox.getPermissionStatus('execute_command')).toBe('denied')
      expect(sandbox.getPermissionStatus('web_search')).toBe('granted')
    })

    it('获取所有权限状态', () => {
      const allPerms = sandbox.getAllPermissions()
      expect(Object.keys(allPerms).length).toBe(9)
      expect(allPerms.web_search).toBe('granted')
      expect(allPerms.execute_command).toBe('denied')
    })
  })

  describe('工具访问检查', () => {
    it('Chat 模式拒绝所有工具', () => {
      const result = sandbox.checkToolAccess('search_web', ToolMode.Chat)
      expect(result.allowed).toBe(false)
    })

    it('Agent 模式允许安全工具（需授予权限）', () => {
      // search_web 需要 web_search 权限（默认授予）
      const result = sandbox.checkToolAccess('search_web', ToolMode.Agent)
      expect(result.allowed).toBe(true)
    })

    it('Agent 模式拒绝 open_application（权限默认拒绝）', () => {
      const result = sandbox.checkToolAccess('open_application', ToolMode.Agent)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('open_app')
    })

    it('授予权限后允许工具执行', () => {
      sandbox.grantPermission('open_app')
      const result = sandbox.checkToolAccess('open_application', ToolMode.Agent)
      expect(result.allowed).toBe(true)
    })

    it('Developer 模式允许文件读取（需授权）', () => {
      sandbox.grantPermission('read_files')
      const result = sandbox.checkToolAccess('read_file', ToolMode.Developer)
      expect(result.allowed).toBe(true)
    })

    it('Worker 模式允许所有工具（需授权）', () => {
      sandbox.grantPermission('execute_command')
      const result = sandbox.checkToolAccess('execute_command', ToolMode.Worker)
      expect(result.allowed).toBe(true)
    })
  })

  describe('风险等级', () => {
    it('搜索和宠物操作为低风险', () => {
      const result = sandbox.checkToolAccess('search_web', ToolMode.Agent)
      expect(result.riskLevel).toBe('low')
    })

    it('打开应用为中风险', () => {
      sandbox.grantPermission('open_app')
      const result = sandbox.checkToolAccess('open_application', ToolMode.Agent)
      expect(result.riskLevel).toBe('medium')
    })

    it('写入文件为高风险', () => {
      sandbox.grantPermission('write_files')
      const result = sandbox.checkToolAccess('write_file', ToolMode.Worker)
      expect(result.riskLevel).toBe('high')
    })

    it('执行命令为关键风险', () => {
      sandbox.grantPermission('execute_command')
      const result = sandbox.checkToolAccess('execute_command', ToolMode.Worker)
      expect(result.riskLevel).toBe('critical')
    })
  })

  describe('文件系统沙箱', () => {
    it('禁止写入系统目录', () => {
      sandbox.grantPermission('write_files')
      const result = sandbox.checkToolAccess('write_file', ToolMode.Worker, {
        path: 'C:\\Windows\\System32\\test.txt',
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('沙箱保护')
    })

    it('禁止写入 .ssh 目录', () => {
      sandbox.grantPermission('write_files')
      const result = sandbox.checkToolAccess('write_file', ToolMode.Worker, {
        path: '/home/user/.ssh/authorized_keys',
      })
      expect(result.allowed).toBe(false)
    })

    it('允许写入用户目录', () => {
      sandbox.grantPermission('write_files')
      const result = sandbox.checkToolAccess('write_file', ToolMode.Worker, {
        path: 'C:\\Users\\Test\\Documents\\test.txt',
      })
      expect(result.allowed).toBe(true)
    })

    it('Agent 模式限制读取目录', () => {
      sandbox.grantPermission('read_files')
      // 不在允许目录列表内的路径
      const result = sandbox.checkToolAccess('read_file', ToolMode.Agent, {
        path: 'C:\\Windows\\System32\\config\\sam',
      })
      expect(result.allowed).toBe(false)
    })

    it('Worker 模式允许读取任意目录', () => {
      sandbox.grantPermission('read_files')
      const result = sandbox.checkToolAccess('read_file', ToolMode.Worker, {
        path: 'C:\\Windows\\System32\\config\\sam',
      })
      expect(result.allowed).toBe(true)
    })

    it('允许读取桌面目录', () => {
      sandbox.grantPermission('read_files')
      const result = sandbox.checkToolAccess('read_file', ToolMode.Developer, {
        path: 'C:\\Users\\Test\\Desktop\\test.txt',
      })
      expect(result.allowed).toBe(true)
    })

    it('允许相对路径读取', () => {
      sandbox.grantPermission('read_files')
      const result = sandbox.checkToolAccess('read_file', ToolMode.Developer, {
        path: './src/test.txt',
      })
      expect(result.allowed).toBe(true)
    })
  })

  describe('确认机制', () => {
    it('写入文件需要确认', () => {
      const result = sandbox.checkToolAccess('write_file', ToolMode.Worker)
      expect(result.needsConfirmation).toBe(true)
    })

    it('执行命令需要确认', () => {
      const result = sandbox.checkToolAccess('execute_command', ToolMode.Worker)
      expect(result.needsConfirmation).toBe(true)
    })

    it('搜索不需要确认', () => {
      const result = sandbox.checkToolAccess('search_web', ToolMode.Agent)
      expect(result.needsConfirmation).toBe(false)
    })
  })

  describe('审计日志', () => {
    it('记录审计日志', () => {
      sandbox.logAudit({
        toolName: 'search_web',
        params: { query: 'test' },
        riskLevel: 'low',
        mode: ToolMode.Agent,
        result: 'allowed',
      })
      const log = sandbox.getAuditLog()
      expect(log.length).toBe(1)
      expect(log[0].toolName).toBe('search_web')
      expect(log[0].result).toBe('allowed')
    })

    it('限制日志大小', () => {
      for (let i = 0; i < 600; i++) {
        sandbox.logAudit({
          toolName: 'search_web',
          params: {},
          riskLevel: 'low',
          mode: ToolMode.Agent,
          result: 'allowed',
        })
      }
      const log = sandbox.getAuditLog(500)
      expect(log.length).toBe(500)
    })

    it('清除审计日志', () => {
      sandbox.logAudit({
        toolName: 'search_web',
        params: {},
        riskLevel: 'low',
        mode: ToolMode.Agent,
        result: 'allowed',
      })
      sandbox.clearAuditLog()
      expect(sandbox.getAuditLog().length).toBe(0)
    })

    it('按时间倒序排列', () => {
      sandbox.logAudit({ toolName: 'first', params: {}, riskLevel: 'low', mode: ToolMode.Agent, result: 'allowed' })
      sandbox.logAudit({ toolName: 'second', params: {}, riskLevel: 'low', mode: ToolMode.Agent, result: 'allowed' })
      const log = sandbox.getAuditLog()
      expect(log[0].toolName).toBe('second')
      expect(log[1].toolName).toBe('first')
    })
  })

  describe('工具风险摘要', () => {
    it('获取 Agent 模式工具风险', () => {
      const summary = sandbox.getToolRiskSummary(ToolMode.Agent)
      expect(summary.length).toBeGreaterThan(0)
      const searchTool = summary.find((s) => s.tool === 'search_web')
      expect(searchTool).toBeTruthy()
      expect(searchTool!.risk).toBe('low')
    })
  })

  describe('单例', () => {
    it('getAgentSandbox 返回同一实例', () => {
      const a = getAgentSandbox()
      const b = getAgentSandbox()
      expect(a).toBe(b)
    })
  })
})
