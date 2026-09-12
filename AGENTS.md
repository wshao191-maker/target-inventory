# 供应链目标库存测算：权威需求说明

本文件是本工具的权威需求说明；目录内其他需求文档若与本文件冲突，以本文件为准。

## 定位

帮助供应链计划人员快速算出一个产品当前的目标库存水平：使用者填入月需求、采购提前期、提前期波动、预测波动、服务水平、下单周期、MOQ 等参数，点一次「计算目标库存」，即得到结果与完整换算过程。

## 计算公式

```
日均需求   = 月需求 ÷ 月计天数
MAPE       = 1 − 预测准确率（直接录入 MAPE 时取录入值）
σ需求      = MAPE × 日均需求
Z          = 标准正态分布反函数（服务水平）
提前期需求 = 日均需求 × 采购提前期
安全库存   = Z × √(采购提前期 × σ需求² + 日均需求² × 提前期波动²)
周转库存   = 0.5 × max(日均需求 × 下单周期, MOQ)
冻结库存   = 日均需求 × 冻结天数
目标库存   = 安全库存 + 周转库存 + 提前期需求 + 冻结库存
库存天数   = 数量 ÷ 日均需求
```

- 目标库存向上取整为整数件，同时展示原始小数。
- 周转库存按半个订货批量的平均占用口径计算，取「下单周期需求」与「MOQ」的较大值后除以 2。
- 库存天数为结果呈现口径，按日均需求折算；月需求为 0 时无法折算，显示「—」。
- Z 值按标准正态分布反函数在页面内近似计算，显示 3 位小数；服务水平取值范围为 50%–99.99%。
- σ需求 主口径为 `MAPE × 日均需求`；参考口径为 `1.25 × MAPE × 日均需求`，仅作对照，不影响主结果。
- 建议下单量：现有库存 ≥ 目标库存时为 0；否则为 `max(MOQ, ceil(目标库存 − 现有库存))`，并标注是否被 MOQ 下限约束。

## 输入字段

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| 产品名称 / SKU | 文本 | 否 | 空 | 仅用于结果标题与复制文本 |
| 月需求 | 数值（件/月） | 是 | 空 | 未来一个月预测需求 |
| 月计天数 | 数值（天） | 是 | 30 | 可改为工作日口径，需自行与提前期保持一致 |
| 采购提前期 | 数值（天） | 是 | 空 | 从下单到可用 |
| 提前期波动 σ | 数值（天） | 否 | 0 | 提前期标准差 |
| 预测准确率 / MAPE | 数值（%）+ 口径切换 | 是 | 准确率 85 | 两个口径等价换算 |
| 服务水平 | 数值（%） | 是 | 95 | 50–99.99 |
| 下单周期 | 数值（天） | 是 | 空 | 两次下单间隔 |
| MOQ | 数值（件） | 是 | 空 | 最小起订量 |
| 冻结天数 | 数值（天） | 否 | 0 | 被质检或占用无法动用的天数 |
| 现有库存 | 数值（件） | 否 | 0 | 用于算建议下单量 |

选填项留空按 0 处理。

## 界面分组与字段提示

- 表单按业务含义分为三组：「需求与波动」（产品名称/SKU、月需求、月计天数、预测准确率/MAPE）、「供应与订货」（采购提前期、提前期波动 σ、下单周期、MOQ）、「服务与库存」（服务水平、冻结天数、现有库存）。
- 每个字段的说明收进字段名右侧的问号气泡：桌面悬停或聚焦显示、点击固定；移动端点击展开，点击外部或按 Esc 关闭；气泡带 `role="tooltip"` 与 `aria-expanded`，键盘可达。
- 预测准确率的气泡文案由脚本在切换口径时实时改写，该元素必须保留。

## 校验规则

- 必填项为空：阻止计算，提示「请填写××」并标红该字段。
- 输入非数字：阻止计算，提示「请输入数字」。
- 负数：阻止计算，提示「不能为负数」。
- 月计天数 ≤ 0：阻止计算。
- 服务水平低于 50% 或高于 99.99%：阻止计算。
- 预测准确率不在 (0, 100] 或 MAPE 不在 [0, 100)：阻止计算。
- 校验失败时在表单顶部汇总「有 N 项需要修正」。

## 结果展示

- 呈现口径：结果区顶部提供「按件数 / 按天数」切换，默认按件数；切换只影响展示单位，不影响任何计算结果。
- 主结果：浅色主调卡片内的大号数字 + 单位，下方小字给出原始值与另一种口径的折算。
- 堆叠构成条：一条 100% 圆角横条，四段按占比着色、段间留白；数值为 0 的段不渲染，避免空缝。
- 四段构成：安全库存、周转库存、提前期需求、冻结库存；每行为「圆点 + 名称 + 当前单位数值 + 占比与另一单位小字」，四条使用四个固定配色。
- 建议下单量：常显提示条，含数值、天数换算与 MOQ 约束说明。
- 关键中间量：日均需求、MAPE、σ需求（主口径）、Z 值，常显。
- 换算过程、参考口径（1.25 × MAPE 口径）、计算公式说明：合并进一个默认收起的折叠区。
- 首次计算时结果区有淡入动效、堆叠条自 0 展开；切换呈现口径不重播；`prefers-reduced-motion` 下全部关闭。

## 存储与隐私

- 参数实时保存到浏览器 localStorage，刷新后回填；`localStorage` 不可用时静默降级，不影响计算。
- 键名：参数 `supplychain.targetInventory.params`，口径 `supplychain.targetInventory.accuracyMode`。
- 呈现口径同样持久化，键名 `supplychain.targetInventory.displayUnit`。
- 无账号、无云同步、不上传任何数据。
- 提供「查看可复制的文本」按钮：展开只读文本框展示结果摘要（输入参数、四段构成、建议下单量），聚焦时自动全选，由使用者手动复制。小工具容器禁用了剪贴板能力，因此不提供一键复制。

## 技术约束

- 纯前端静态实现：`index.html` + `styles.css` + `app.js`，无后端、无构建、无第三方依赖。
- 中文界面，默认浅色主题，窄屏（手机宽度）可用且无横向滚动。
- 计算内核通过 `window.TargetInventoryCore` 暴露，便于自检。
- 同一份代码有**两个交付物**：GitHub Pages 网页版，以及符合小红书小工具容器规范的离线 zip。任何改动都必须同时满足两者的约束。

## 小工具打包约束

打包规范来自 `minitool-zip-builder` 技能（`E:\codex exp\.agents\skills\minitool-zip-builder\`）。改动工具内容时必须保持以下约束，**违反任意一条都会导致小工具加载失败或行为异常**：

### 包结构

- zip 内 `index.html` 位于**根目录**，其余文件平铺或用相对路径引用；不得多套一层目录。
- 只允许 `.html` / `.css` / `.js` / 图片 / 字体 / `.json`；不得包含 `node_modules`、`.git`、`*.map`、构建配置。
- 打包压缩的是「与 `index.html` 同级的那批文件」，不是它们所在的文件夹。

### 页面与资源

- `index.html` 需有 `<!DOCTYPE html>`、`lang="zh-CN"`、`charset=UTF-8`。
- viewport 必须含 `width=device-width, initial-scale=1.0, viewport-fit=cover`。
- 全部资源为相对路径（`./xxx`）；**不得引用任何 `http(s)://` 外部资源**，容器不联网。
- 脚本必须外置：禁止内联 `<script>`、禁止 `onclick=` 等行内事件、禁止 `javascript:` / `eval()` / `new Function()`。
- 必须是**经典脚本**：不要 `type="module"`，JS 内不要 `import` / `export`。
- 禁止 `<base href>`、`<iframe>` / `<object>`、自建 CSP `<meta>`。

### 被禁用的容器能力（命中即必须移除）

`navigator.clipboard`（含读取与写入）、`document.execCommand('copy'/'cut'/'paste')`、`fetch` / `XMLHttpRequest` 等一切网络请求、`navigator.geolocation`、蓝牙 / USB / 串口 / 传感器、`WebSocket` / `EventSource` / `RTCPeerConnection`、Web Worker / Service Worker、`window.open` / `window.prompt`、`location.href` 跳转站外、`<a download>`、`target="_blank"`、WebAssembly、`Element.requestFullscreen`。

**允许使用**：`localStorage` / `sessionStorage` / `IndexedDB`、`alert()` / `confirm()`、touch / pointer 事件、标准 DOM / CSS / Canvas 2D / WebGL。

> 需要「复制文本」这类能力时，按规范改为**展示可选中文本**，引导使用者长按 / 选中手动复制。

### 兼容性基线

- **JS**：最低基线为 Android 8.1 出厂 Chrome / WebView 61，直接交付的代码以 **ES2017** 为上限；不得使用对象展开、可选链 `?.`、空值合并 `??`、`top-level await` 等 ES2018+ 语法。
- **CSS**：采用「Chrome 61 基线层 + 能力检测增强层」，只维护一套组件规则。
  - Flexbox 的 `gap` 晚于 Chrome 61：基线用子项 `margin`，由 JS **实际布局测量**确认支持后加 `.supports-flex-gap` 再切到 `column-gap` / `row-gap`。不得用 `@supports (gap: 1px)` 或 `CSS.supports('gap','1px')` 冒充 Flex gap 检测。
  - Grid 间距使用 `grid-gap`，不用 `gap`。
  - 焦点样式以 `:focus` 为基线，不得只依赖 `:focus-visible`。
  - 悬停效果包进 `@media (hover: hover)`，关键操作不得只在悬停时出现。
  - 不使用 `aspect-ratio`、`clamp()`、逻辑属性、`:has()`、Container Queries、Subgrid、CSS Nesting、`dvh/svh/lvh` 等晚于基线的能力。
  - 安全区用 `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))`，并保留静态兜底。
- 当前交付状态：**Chrome 61 / Android 8.1 兼容性未实测**（无对应真机或模拟器），结论来自静态扫描与规范比对。

### 体积门禁

- 最终 zip 不超过 **10 MiB**（硬上限），建议不超过 2 MiB。
- 单个 `.html` / `.css` / `.js` / `.json` 超过 2 MiB、文本合计超过 5 MiB 时需人工复核。
- 单条 Base64 解码后不超过 1 MiB；不得把大型数据集塞进 JS / JSON。

## 更新与发布流程

工具内容的改动都在本目录下进行，两个交付物由两个脚本分别产出：

```powershell
# 1. 改代码：index.html / styles.css / app.js

# 2. 重新打包小工具 zip（生成 minitool\dist\ 与 minitool\目标库存测算小工具.zip）
.\build-minitool.ps1

# 3. 提交并推送，网页版自动重新部署
.\deploy.ps1 "这次改了什么"
```

要点：

- `build-minitool.ps1` 每次都会清空重建 `minitool\`，避免残留旧文件被打进包；压缩的是 `dist` 目录内容，因此 `index.html` 直接位于 zip 根目录。
- `minitool\` 已在 `.gitignore` 中忽略，打包产物不会进入网页部署仓库。
- `deploy.ps1` 会自动提交改动并推送；GitHub Pages 约 1–2 分钟、Cloudflare Pages 约 30 秒后更新，**链接保持不变**。
- 只改文档（如本文件）时无需重新打包小工具，但仍建议跑 `deploy.ps1` 保持本地与远端一致。

### 改动后必须做的核对

1. 按 `references/zip-artifact-spec.md` 末尾的自检清单逐项核对包结构与页面规范。
2. 扫描代码中是否残留被禁能力（`navigator.clipboard`、`execCommand`、`fetch`、内联脚本、`https://` 外部引用等）。
3. 跑审计脚本做体积门禁（目录审计要在压缩前做）：

   ```powershell
   $skill = "..\.agents\skills\minitool-zip-builder"
   node "$skill\scripts\audit_artifact.mjs" .\minitool\dist
   node "$skill\scripts\audit_artifact.mjs" ".\minitool\目标库存测算小工具.zip"
   ```

4. 在 PC 模拟器与真机上各跑一遍核心流程（填参数 → 计算 → 切换呈现口径 → 查看可复制文本），确认无异常。
