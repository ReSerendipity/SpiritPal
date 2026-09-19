# SpiritPal 路由持久化修复脚本
# 用 $PSScriptRoot 推导仓库内路径，保证克隆到任意目录均可运行
$contentPath = Join-Path $PSScriptRoot "App.tsx"
$content = Get-Content $contentPath -Raw -Encoding UTF8

# 替换 getRoute 函数
$oldGetRoute = @"
function getRoute(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return hash || '/pet'
}
"@

$newGetRoute = @"
function getRoute(): string {
  // 优先从 localStorage 读取上次会话的路由
  try {
    const lastRoute = localStorage.getItem('spiritpal:last_route')
    if (lastRoute && lastRoute.startsWith('/')) {
      // 更新 URL hash 以匹配 localStorage 状态
      window.location.hash = lastRoute
      return lastRoute
    }
  } catch {
    // localStorage 不可用（隐私模式），回退到默认行为
  }

  const hash = window.location.hash.replace(/^#/, '')
  return hash || '/pet'
}
"@

if ($content -match [regex]::Escape($oldGetRoute)) {
    $content = $content.Replace($oldGetRoute, $newGetRoute)

    # 添加 localStorage 同步 useEffect
    $oldUseEffect = @"
  useEffect(() => {
    const onHash = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const checkMobile = () => setIsMobile(detectMobile())
"@

    $newUseEffect = @"
  useEffect(() => {
    const onHash = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 路由变化时同步到 localStorage
  useEffect(() => {
    if (!route) return
    try {
      localStorage.setItem('spiritpal:last_route', route)
    } catch {
      // localStorage 不可用时忽略错误
    }
  }, [route])

  useEffect(() => {
    const checkMobile = () => setIsMobile(detectMobile())
"@

    if ($content -match [regex]::Escape($oldUseEffect)) {
        $content = $content.Replace($oldUseEffect, $newUseEffect)
        Set-Content $contentPath -Value $content -NoNewline -Encoding UTF8
        Write-Host "✓ SpiritPal 路由持久化功能已添加" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "✗ 未找到 useEffect 代码块" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✗ 未找到 getRoute 函数" -ForegroundColor Red
    exit 1
}
