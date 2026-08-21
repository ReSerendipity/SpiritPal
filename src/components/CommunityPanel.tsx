/**
 * 社区形象面板
 *
 * 功能尚未完善：原 mock 数据版本已移除。
 * 后端上线前，此页明确提示用户功能未开放，不展示任何假数据。
 */
import { FeatureComingSoon } from './FeatureComingSoon'

export function CommunityPanel() {
  return (
    <FeatureComingSoon
      title="社区形象"
      description="社区功能正在建设中，上线后将支持浏览、下载、上传玩家分享的角色形象与模组。"
    />
  )
}
