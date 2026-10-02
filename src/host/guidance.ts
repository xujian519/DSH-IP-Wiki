/**
 * The prompt section that tells an agent the library exists, where it is, and
 * which tools write to it, so the agent reads cards through the panel's routes
 * instead of guessing at paths and never writes a card behind the user's back.
 * @module dsh-ip-wiki/host/guidance
 */

/** Section name the prompt registry keys this contribution by. */
export const GUIDANCE_NAME = 'plugin:ip-wiki'

/** Section order: after the workbench's own guidance, before the environment tail. */
export const GUIDANCE_ORDER = 160

/**
 * Compose the guidance text for one library root.
 * @param root - absolute library root the plugin is reading.
 * @returns the section text.
 */
export function guidance(root: string): string {
  return [
    '本机已安装 dsh-ip-wiki 插件（IP 知识库）：侧边栏「IP 知识库」入口，主面板内可浏览卡片树、阅读卡片、',
    `查看整理报告与待确认草稿。库根：${root}（纯 Markdown，索引可重建）。`,
    '卡片为分型卡（概念卡 / 规则卡 / 案例卡 / 法条卡）。写库一律先草稿、由用户确认后才落库（落库前先备份，可回滚）：',
    'ip_wiki_draft 提交新卡或合并草稿；ip_wiki_confirm 把已入库、状态仍是「未确认」的卡片提交为状态确认草稿；',
    'ip_wiki_review 列草稿 / 看差异 / 确认 / 作废 / 回滚。未经确认的草稿不会出现在检索结果里。',
    '用户提到「知识库 / 卡片 / IP 知识库 / 卡片整理」时即指本插件；需要读卡片正文时用面板或直接读库内文件。',
  ].join('')
}
