# 侧栏界面 Tab 化改造方案

> 状态:待审查
> 产物原型:`resources/webview/tabbed-ui-demo.html`(已完成并截图验证)
> 目标:把当前竖排折叠面板(`<details>`)改成顶部 4 个 Tab 切换。

## 1. 背景与目标

当前侧栏(`src/sidebarProvider.ts` 的 `_getHtmlForWebview`)把所有功能竖排成 5 个独立折叠卡片,屏幕利用率低、滚动长。改造为顶部 4 Tab:

| Tab | 默认 | 归入的现有面板 |
|---|---|---|
| **账户** | ✅ 选中 | 我的账号(汇总+列表),`list-card` |
| **实例** | | 多实例分身,`#instanceArea` |
| **自动化** | | 自动切号 `#autoSwitchArea` + 自动继续 `#autoContinueArea` |
| **增强** | | 界面增强(增强/汉化/气泡/完成提醒/状态栏/ACP),`#enhanceArea` |

产品名同步:`Windsurf 号池 / xxx 增强` → **IDE 增强助手**(标题及「号池」字样清理,以 demo 为准)。

## 2. 现状定位(已核对)

- HTML 主函数:`src/sidebarProvider.ts:2064 _getHtmlForWebview()`,单一模板字符串,`<body>` 在 `:2078`,`<div class="app">` 在 `:2079`,`</body>` 在 `:3553`。
- 面板容器(均为 `<div class="card ..." id="...Area">` + 内部 `<details>`):
  - 增强:`:2082 #enhanceArea`(details `#enhanceDetails`)
  - 自动切号:`:2356 #autoSwitchArea`(details `#asDetails`)
  - 自动继续:`:2458 #autoContinueArea`(details `#acDetails`,内部已有 segment tab `acTab*`)
  - 多实例:`:2874 #instanceArea`(details `#instDetails`)
  - 我的账号:`:3040 list-card`(details `#listDetails`)
- CSS/JS:外部文件 `resources/webview/main.css`(~3927 行)、`resources/webview/main.js`(~6200 行),由 `:2068-2069` 注入,带 `?v=版本` 缓存戳。
- 消息通信:`onDidReceiveMessage`(`:698`)→ `handleMessage`(`:784` switch)。**后端无需改动**。
- 折叠持久化:`main.js:5714 persistDetailsState()`,localStorage KEY=`ws-pool-details-open`,跟踪 5 个 details 的 open 状态。
- 已有局部 tab:`add-tab`(添加账号模态)、`acTab` segment(自动继续守护/长任务)。**全局顶部 tab 尚未实现**。

## 3. 改造方案

### 3.1 HTML(sidebarProvider.ts)

1. 在 `:2079 <div class="app">` 之后、面板之前,插入 Tab 导航栏:
   ```html
   <div class="app-tabs" role="tablist">
     <button class="app-tab active" data-tab="account" ...>账户 <span class="tab-count" id="tabAccountCount">…</span></button>
     <button class="app-tab" data-tab="instance" ...>实例 <span class="tab-count" id="tabInstanceCount">…</span></button>
     <button class="app-tab" data-tab="automation" ...>自动化</button>
     <button class="app-tab" data-tab="enhance" ...>增强</button>
   </div>
   ```
   - tab 数字徽标(账户数、实例数)复用现有动态渲染逻辑填充。
2. 用 4 个 `<div class="tab-page" id="tab-xxx">` 把 5 个 `card` 重新归类包裹:
   - `#tab-account` ← 我的账号 card
   - `#tab-instance` ← `#instanceArea`
   - `#tab-automation` ← `#autoSwitchArea` + `#autoContinueArea`
   - `#tab-enhance` ← `#enhanceArea`
   - 账户页加 `active` 类作为默认。
3. **保留各 card 的 `id` 和内部 DOM 结构不变**(避免影响 main.js 大量 getElementById)。Tab 化只是外层重新分组 + 容器包裹。
4. 折叠语义保留:`<details>` 仍可用(tab 内的二级折叠),不强制拆除,降低改动面。

### 3.2 CSS(main.css)

把 demo 里新增的样式块并入 `main.css` 末尾:`.app-tabs`、`.app-tab`(含 `.active`、`::after` 渐变底边、`.tab-count`)、`.tab-page`(默认 `display:none`,`.active` 显示)。颜色变量复用现有 `main.css` 的 GitHub 配色,无需新增变量。

### 3.3 JS(main.js)

1. 新增 `switchTab(tabKey)`:切换 `.app-tab.active` 与 `.tab-page.active`,并持久化当前 tab。
2. 绑定 tab 按钮点击。
3. **持久化改造**:`persistDetailsState()`(`:5714`)保留(管二级 details),**新增** activeTab 持久化,建议 localStorage KEY=`ws-pool-active-tab`,初始化时读取并恢复(无值时默认 `account`)。
4. **重点排查**(改造关键风险):现有代码里按开关状态对 `<details>` 做 `setAttribute('open')` 的逻辑(`main.js:3125`、`:5441` 等,按 `autoSwitchEnabled` 等条件展开面板)。这些"自动展开 details"的行为在 tab 化后,若目标 details 在非激活 tab 内则用户看不到。需评估:
   - 若是"启用某功能时自动展开其面板"的引导逻辑 → 改成"切换到对应 tab"或保留 details 展开(因为 details 仍在,只是所在 tab 可能未激活,不影响数据,可接受)。
   - 优先低改动:保留 details open 行为不动,只要 tab 内能正常展开即可。

### 3.4 不改动项

- 后端 `handleMessage` 及所有 postMessage 协议。
- 各 card 内部业务 DOM、事件绑定、渲染函数。
- 添加账号模态 `add-tab`、自动继续 `acTab` 等局部 tab 保持原样。

## 4. 风险与注意

1. **getElementById 依赖**:main.js 大量按 id 取元素,改造严禁修改/删除现有 id,只做容器包裹。
2. **details 自动展开逻辑**(3.3.4):唯一需要逐处确认的风险点,改造时 grep `setAttribute('open'` / `.open =` 逐一核对。
3. **缓存戳**:css/js 变更后版本号 `?v=` 会随 extVersion 自动更新,无需手动处理。
4. **Devin 兼容**:`detectIdeFlavor()==='devin'` 分支若对面板有差异化处理,需确认 tab 化后仍兼容(`ideName` 已是动态变量,标题不写死)。

## 5. 实施步骤(开发时)

1. main.css 末尾追加 tab 样式。
2. sidebarProvider.ts:插入 tab 导航 + 4 个 tab-page 容器包裹现有 card(纯结构,不动 id)。
3. main.js:加 `switchTab` + activeTab 持久化 + tab 数字徽标填充。
4. grep 核对 details 自动展开逻辑(风险点 3.3.4)。
5. 编译 + 在 Windsurf 中实测 4 个 tab 切换、各功能正常、刷新后 tab 记忆。

## 6. 验收标准

- 顶部 4 tab,账户默认选中,点击切换流畅。
- 各功能交互(切号、自动继续 segment、账号增删、实例启停、气泡预览)全部正常。
- 重新打开侧栏恢复上次所在 tab。
- 无 console 报错。
