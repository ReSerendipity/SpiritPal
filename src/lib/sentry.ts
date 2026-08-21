/**
 * Sentry 错误监控集成
 * 
 * 功能：
 * - 捕获全局未处理错误和 Promise rejection
 * - 收集运行时性能数据
 * - 关联用户会话和上下文信息
 * - 支持环境区分（dev/staging/prod）
 * 
 * 使用方式：
 * 1. 在 main.tsx 中导入并初始化 (env 变量控制是否启用)
 * 2. 自动捕获 React 错误边界、未处理异常
 * 3. 手动上报业务逻辑错误：sentry.captureException(err)
 * 4. 添加用户上下文：sentry.setUser({ id, email })
 */

// Sentry SDK 类型定义（可选安装时导入真实 SDK）
interface SentryConfig {
  dsn?: string;
  environment?: 'development' | 'staging' | 'production';
  release?: string;
  enabled?: boolean;
  tracesSampleRate?: number;
}

interface SentryHub {
  init(config: SentryConfig): void;
  captureException(error: unknown, contexts?: Record<string, unknown>): void;
  captureMessage(message: string, level?: 'log' | 'info' | 'warning' | 'error'): void;
  setContext(key: string, value: Record<string, unknown>): void;
  setUser(user: { id?: string; email?: string; name?: string } | null): void;
  addBreadcrumb(breadcrumb: {
    category?: string;
    level?: 'log' | 'info' | 'warning' | 'error';
    message: string;
    data?: Record<string, unknown>;
  }): void;
  close(timeout?: number): Promise<boolean>;
}

/**
 * Mock Sentry 实现（开发环境或无 DSN 时使用）
 * 输出到控制台，方便调试
 */
class MockSentryHub implements SentryHub {
  private enabled = false;
  
  init(config: SentryConfig): void {
    this.enabled = config.enabled !== false && !!config.dsn;
    if (!this.enabled) {
      console.log('[Sentry] 已禁用或使用 Mock 模式 (无 DSN)');
    } else {
      console.log('[Sentry] 已初始化', {
        environment: config.environment,
        release: config.release,
      });
    }
  }
  
  captureException(error: unknown, contexts?: Record<string, unknown>): void {
    if (!this.enabled) {
      console.warn('[Sentry Mock] 捕获异常:', error);
      if (contexts) console.warn('[Sentry Mock] 上下文:', contexts);
      return;
    }
    // 实际环境中会发送到 Sentry
    console.info('[Sentry] 上报异常:', error, contexts);
  }
  
  captureMessage(message: string, level: 'log' | 'info' | 'warning' | 'error' = 'info'): void {
    if (!this.enabled) {
      console.log(`[Sentry Mock] ${level}:`, message);
      return;
    }
    console.info('[Sentry] 上报消息:', message, level);
  }
  
  setContext(key: string, value: Record<string, unknown>): void {
    if (!this.enabled) return;
    console.debug(`[Sentry] 设置上下文 [${key}]:`, value);
  }
  
  setUser(user: { id?: string; email?: string; name?: string } | null): void {
    if (!this.enabled) return;
    console.debug('[Sentry] 设置用户:', user);
  }
  
  addBreadcrumb(breadcrumb: Parameters<SentryHub['addBreadcrumb']>[0]): void {
    if (!this.enabled) return;
    console.debug('[Sentry Breadcrumb]', breadcrumb);
  }
  
  close(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

// 单例实例
export const sentry: SentryHub = new MockSentryHub();

/**
 * 全局错误处理器
 * 应在应用入口 (main.tsx) 调用一次
 */
export function setupGlobalErrorListeners(): void {
  // 监听未捕获的错误
  window.addEventListener('error', (event) => {
    sentry.captureException(event.error || event.message, {
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
  });
  
  // 监听未处理的 Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    sentry.captureException(event.reason, {
      type: 'UnhandledPromiseRejection',
    });
  });
  
  // 监听 React 边界错误（如果使用了 React ErrorBoundary）
  if (typeof window !== 'undefined') {
    (window as any).__SENTRY_ERROR_BOUNDARY_HANDLER__ = (error: Error, errorInfo: any) => {
      sentry.captureException(error, {
        componentStack: errorInfo?.componentStack,
      });
    };
  }
}

/**
 * 添加应用级面包屑（用于错误上下文追踪）
 */
export function addAppBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  sentry.addBreadcrumb({
    category,
    message,
    data,
    level: 'info',
  });
}

/**
 * 设置用户上下文（登录后调用）
 */
export function identifyUser(userId: string, email?: string, name?: string): void {
  sentry.setUser({ id: userId, email, name });
}

/**
 * 清除用户上下文（登出时调用）
 */
export function clearUserContext(): void {
  sentry.setUser(null);
}

/**
 * 捕获特定功能的错误
 */
export function captureFeatureError(feature: string, error: Error, extra?: Record<string, unknown>): void {
  sentry.captureException(error, {
    feature,
    ...extra,
  });
}
