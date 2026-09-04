import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock piiMasking
vi.mock('@/lib/data/piiMasking', () => ({
  maskPII: vi.fn((s: string) => s.replace(/1[3-9]\d{9}/g, '138****1234')),
}))

// Mock dynamic import of @sentry/browser
vi.mock('@sentry/browser', () => {
  throw new Error('Module not found')
})

import {
  initSentry,
  getSentry,
  sentry,
  setupGlobalErrorListeners,
  addAppBreadcrumb,
  clearLocalErrorLog,
  getLocalErrorCount,
  exportLocalErrorLog,
  captureFeatureError,
  identifyUser,
  clearUserContext,
} from '@/lib/system/sentry'

describe('Sentry Integration', () => {
  beforeEach(() => {
    clearLocalErrorLog()
  })

  afterEach(() => {
    clearLocalErrorLog()
  })

  describe('initSentry', () => {
    it('should use Mock hub when no DSN provided', async () => {
      await initSentry({ enabled: false })
      const hub = getSentry()
      expect(hub.isRealSentry()).toBe(false)
    })

    it('should fallback to Mock hub when SDK unavailable', async () => {
      await initSentry({ dsn: 'https://fake@sentry.io/123', enabled: true })
      const hub = getSentry()
      expect(hub.isRealSentry()).toBe(false)
    })
  })

  describe('Local Error Log', () => {
    it('should store errors to local log when using mock hub', async () => {
      await initSentry({ enabled: false })
      const hub = getSentry()
      hub.captureException(new Error('test error'), { feature: 'test' })
      expect(getLocalErrorCount()).toBeGreaterThan(0)
    })

    it('should store messages to local log', async () => {
      await initSentry({ enabled: false })
      const hub = getSentry()
      hub.captureMessage('test message', 'warning')
      expect(getLocalErrorCount()).toBeGreaterThan(0)
    })

    it('should export local error log as JSON', async () => {
      await initSentry({ enabled: false })
      getSentry().captureMessage('test export', 'info')
      const exported = exportLocalErrorLog()
      const parsed = JSON.parse(exported)
      expect(parsed.count).toBeGreaterThan(0)
      expect(parsed.errors).toBeInstanceOf(Array)
    })

    it('should clear local error log', async () => {
      await initSentry({ enabled: false })
      getSentry().captureMessage('test clear', 'info')
      expect(getLocalErrorCount()).toBeGreaterThan(0)
      clearLocalErrorLog()
      expect(getLocalErrorCount()).toBe(0)
    })
  })

  describe('Compatibility API', () => {
    it('sentry object should delegate to current hub', async () => {
      await initSentry({ enabled: false })
      sentry.captureException(new Error('compat test'))
      expect(getLocalErrorCount()).toBeGreaterThan(0)
    })

    it('sentry.captureMessage should work', async () => {
      await initSentry({ enabled: false })
      sentry.captureMessage('compat message', 'info')
      expect(getLocalErrorCount()).toBeGreaterThan(0)
    })
  })

  describe('Helper functions', () => {
    it('captureFeatureError should delegate', async () => {
      await initSentry({ enabled: false })
      captureFeatureError('test-feature', new Error('feature error'))
      expect(getLocalErrorCount()).toBeGreaterThan(0)
    })

    it('addAppBreadcrumb should not throw', async () => {
      await initSentry({ enabled: false })
      expect(() => addAppBreadcrumb('test', 'breadcrumb message')).not.toThrow()
    })

    it('identifyUser/clearUserContext should not throw', async () => {
      await initSentry({ enabled: false })
      expect(() => identifyUser('user-123', 'test@example.com')).not.toThrow()
      expect(() => clearUserContext()).not.toThrow()
    })
  })

  describe('Global Error Listeners', () => {
    it('should register window error listeners', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      setupGlobalErrorListeners()
      expect(addSpy).toHaveBeenCalledWith('error', expect.any(Function))
      expect(addSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function))
      addSpy.mockRestore()
    })
  })
})
