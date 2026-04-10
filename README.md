# 保质期管理页面

一个适合部署到 GitHub Pages 的纯前端便利店保质期管理页面，面向手机浏览器使用。

## 文件结构

```text
.
├── index.html
├── styles.css
├── app.js
└── README.md
```

- `index.html`
  页面骨架，只负责挂载容器和引入静态资源。
- `styles.css`
  所有样式，优先在这里调整页面外观。
- `app.js`
  页面状态、渲染逻辑、事件绑定、日期计算和本地存储逻辑。

## 当前功能

- 商品管理页
- 添加商品页
- 保质期计算器页
- 同名商品按组展示
- 默认展示同名商品中最快过期的一批
- 点击商品区域展开批次明细
- 支持下架、恢复、删除
- 支持本地搜索、筛选、排序
- 使用 `localStorage` 持久化数据

## 核心业务规则

- 生产日期算第 `1` 天
- 按天计算：
  `过期日 = 生产日期 + 保质期天数 - 1`
- 按月计算：
  先按自然月顺延，再减 `1` 天
- 下架日固定为：
  `过期日前 2 天`

示例：

- `2026-03-06` 生产
- 保质期 `7` 天
- 下架日应为 `2026-03-10`
- 过期日应为 `2026-03-12`

## 数据结构

`app.js` 中每个批次记录大致包含：

```js
{
  id,
  name,
  normalizedName,
  category,
  productionDate,
  removalDate,
  expiryDate,
  shelfLifeValue,
  shelfLifeUnit,
  archived,
  archivedAt,
  createdAt
}
```

说明：

- `archived: true`
  代表“已下架但仍保留记录”
- 删除则是直接从数组和 `localStorage` 中移除

## 主要状态

`app.js` 里的 `state` 管理页面核心状态：

- `page`
  当前页面：`manage` / `add` / `calculator`
- `filter`
  列表筛选：`all` / `removeSoon` / `expired`
- `sortBy`
  列表排序方式
- `search`
  搜索关键字
- `expandedGroups`
  当前展开的商品组
- `batches`
  所有批次数据
- `form`
  添加商品表单
- `calculator`
  计算器表单

## 渲染约定

- `render()`
  整体页面重绘入口
- `renderManagePage()`
  管理页
- `renderAddPage()`
  添加商品页
- `renderCalculatorPage()`
  计算器页
- `renderProductCard()`
  商品卡片
- `renderBatchCard()`
  批次明细卡片

局部刷新：

- 搜索输入时不整页重绘，只刷新管理列表
- 表单输入时只刷新预览区域
- 计算器输入时只刷新计算结果区域

如果后面要继续优化交互，尽量保持这个原则，避免输入框失焦问题再次出现。

## 样式修改建议

优先在 `styles.css` 调整：

- 顶部区域：`.topbar`
- 管理页卡片：`.product-card`、`.product-main`
- 摘要日期块：`.date-summary`、`.date-summary-item`
- 批次明细：`.batch-card`
- 底部导航：`.bottom-nav`
- 浮动新增按钮：`.fab`

如果只是做视觉优化，尽量不要改 `app.js`。

## 开发建议

### 1. 先改样式，再改逻辑

如果需求只是“更好看”，先改 `styles.css`，尽量不要动渲染结构。

### 2. 改列表逻辑时，优先看这几个函数

- `groupProductsByName`
- `summarizeProductGroup`
- `sortProductGroups`
- `getVisibleGroups`

### 3. 改日期逻辑时要非常小心

不要改掉“生产日期算第 1 天”这条规则。

### 4. GitHub Pages 部署时保持同层目录

```text
repo-root/
  index.html
  styles.css
  app.js
```

不要随便改资源相对路径。

## 后续可扩展方向

- 导出 / 导入 JSON
- 编辑已有批次
- 已下架专区
- 临期高亮更细化
- 多分类筛选
- PWA 离线安装

## 注意事项

- 当前数据只保存在当前浏览器
- 清除浏览器缓存会导致数据丢失
- 不同设备之间不会自动同步
