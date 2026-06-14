# 品牌命名方案

> 状态：已采用 Kite 作为展示品牌。`package.json` 的 `name`、命令 ID 和配置键仍保持 `windsurf-pool` / `windsurfPool.*`，保证更新和老用户配置连续。

## 背景

- 工具原名 `IDE 号池管理（Windsurf/Devin）`，定位偏「号池/换号」。
- Windsurf 被 Devin（Cognition）收购，产品方向变化，希望重新定位：
  - **淡化「号池」**，突出「增强套件」这一核心定位。
  - 放大的能力：界面增强、多实例分身、BYOK（自带 Key）、多账号号池（降级为接入方式之一）。
- 命名目标：独立品牌，不绑死任何被收购/会改名的平台（Windsurf / Cascade / Devin）；面向中文用户，兼顾英文/国际。

## 当前选定方向

**`Kite` / `Kite — AI IDE 增强套件`**

- `Kite`（风筝）= 独立品牌符号，延续 Windsurf「风」的血脉但完全中立。
- 扩展列表和侧栏使用简洁品牌名 `Kite`；说明文案使用 `AI IDE 增强套件` 补足品类定位。

## 备选名字

| 备选 | 说明 |
|------|------|
| **IDE 增强助手** | 最直白、零理解成本，「助手」偏轻量陪伴感 |
| **IDE 增强套件** | 强调「成套能力」，比「助手」更有体系感 |
| **Kite: IDE增强套件** | 带独立品牌符号 Kite，名片感更强 |

## 命名讨论中沉淀的其他思路（备查）

- **自然/意象类**：潮汐 Tide、蜂群 Hive、群岛 Archipelago、灯塔 Beacon、羽化 Plume。
- **增强/外挂类**：外骨骼 Exo、神盾 Aegis（贴「加装一层让 IDE 变强」的隐喻）。
- **赛博朋克/攻壳类**：Ghost / GhostShell（Ghost=灵魂不变，Shell=可换的义体/账号，"换号=换壳"高度契合）、傀儡师 Puppet Master。
- **避坑**：`Puppeteer`（Google 浏览器库占用）、`Ghost`（知名 CMS 占用）、`Kite`（曾有同名 AI 补全工具，已停运；开发者圈可能联想）。

## 落地约束（重要）

> 改名只动**展示层**，不动**标识层**。

- **不要改** `package.json` 的 `name: "windsurf-pool"` —— 它是 VSIX 更新通道、`windsurfPool.*` 配置键、命令 ID 的唯一锚点。改了会导致老用户收不到更新、设置全部丢失。
- 可安全修改的纯展示文案（后续若定名再统一对齐）：
  - `displayName`、`description`
  - `contributes.viewsContainers.activitybar[].title`
  - `contributes.configuration.title`
  - 各命令的 `category`
