# dsh-automation-monitor

这个是全部dsh制作，当时只是没有搜到类似的插件，我就让他写了一个，然后测试看能不能上传到GitHub上，研究一下居然真的成功了，我根本看不懂代码啊，如果有什么这个项目问题我很抱歉啊，只有这一句话是人类说的，以下内容全是大肥鱼生成的；

DSH 的**自动化任务监视器**。只读，不碰任何别的插件/项目的数据。

装好之后，**每个会话的头部会多一个「自动化」标签页**（跟「上下文」「画廊」「刷过的视频」并排），点开就是：
**谁在自动跑、上次跑没跑、下次什么时候跑、大概花多少 token**。

```
对话 | 轨迹 | 刷过的视频 | 自动化 | 上下文 | 画廊 | 编队
                            ↑ 本插件
```

## 它监视什么

| 来源 | 读哪里 | 说明 |
|---|---|---|
| 刷B站 `dsh-bili-scroll` | `$DSH_HOME/bili-duty/{state,config}.json`、`duty.log`、`out/<日期>.md` | 下次窗口时间按插件真实调度逻辑算（含「夜间跨零点会跑两轮」这个坑） |
| 会话提醒 | `$DSH_HOME/storages/schedule.json` | **能列出别的会话里的提醒**（DSH 自带的 `schedule_list` 只看当前会话） |
| 任务板 cron | `$DSH_HOME/task-board/ledger-v2.json` | 有定时调度的卡片才会出现 |
| 自定义 | `automations.json` | 未来任何自动化，加一条就出现在标签页里 |

标签页顶部还显示今日全局花费与余额（读 `.dshw-usage.json`）。

## 为什么还要一个？（和同类插件的区别）

查过 npm 上 DSH 插件市场（3570 个包）里所有带 `monitor` / `automation` / 监视 字样的：

| 插件 | 它做什么 | 和本插件的关系 |
|---|---|---|
| `dsh-automation-center` | 全局自动化中心：创建、排期、审计 Agent 任务 | **执行端** —— 它自己跑任务 |
| `@michengai/dsh-automation` | 在独立 Session 里按计划执行编码任务 | 执行端 |
| `@hhuangpanda/dsh-automation` | Agent 创建的持久化自动化 | 执行端 |
| `dsh-my-observability` | 事件审计 + 资源看门狗面板 + Git 工具 | 看 agent 行为与资源，不看「下次几点跑」 |
| `dsh-token-monitor` / `@lcthe/dsh-usage-monitor` | 只盯 token 花费 | 只有钱，没有排期 |
| `dsh-rss-monitor` / `dsh-system-monitor-plugin` | RSS / 系统资源 | 不相干 |

**没有一个做这件事**：把「你已经装的别的插件」的自动化排期汇总成一张只读的表 ——
谁在跑、上次跑没跑、下次几点跑、花多少 token。

本插件的定位就一句：**不拥有任何任务，只当那块表。**

## 结构（两个半端，各一个文件）

| 文件 | 半边 | 干什么 |
|---|---|---|
| `lib/index.js` | host | 探针 + 唯一接口 `GET /automation/status.json` |
| `lib/client.js` | 浏览器 | 往 `conversation.view` 槽位注册「自动化」标签页，读上面那个接口，20 秒轮询 |

`lib/client.js` 是**自注册脚本**（不是 ESM），格式必须是：

```js
window.__ModuleLoader__.load({
  id: '<等于 package.json 的 name>',
  factory: (require) => { ...; return { inject: ['slots'], apply(ctx) {...} } },
})
```

标签页的注册只有这一句关键：

```js
slots.inject('conversation.view', () => slots.register({
  name: 'conversation.view',
  id: 'automation-monitor',
  order: 25,          // 20 = 刷过的视频，越大越靠右
  label: '自动化',
  scope: 'session',
}, () => h(AutomationTab)))
```

## 安装状态（2026-10-27 已装）

「目录联接（junction）」方式：

```
E:\dsh-home\profiles\desktop\node_modules\dsh-automation-monitor
   └─junction→ E:\dsh-workspace\dsh-automation-monitor
```

- `<profile>\package.json` 的 `dependencies` 加了 `"dsh-automation-monitor": "0.2.0"`
- 同文件 `dsh.profile.bundles` 末尾加了 `"dsh-automation-monitor"`

⚠️ 因为是 junction，**别删/搬 `E:\dsh-workspace\dsh-automation-monitor`**，否则插件会断链。真要搬就重建：

```powershell
Remove-Item 'E:\dsh-home\profiles\desktop\node_modules\dsh-automation-monitor' -Force
New-Item -ItemType Junction -Path 'E:\dsh-home\profiles\desktop\node_modules\dsh-automation-monitor' -Target '<新路径>'
```

### 卸载

```powershell
Remove-Item 'E:\dsh-home\profiles\desktop\node_modules\dsh-automation-monitor' -Force
```

再把 `<profile>\package.json` 里那两行删掉即可，别的什么都不用动。

## 自检（不需要起 DSH）

```bash
node E:\dsh-workspace\dsh-automation-monitor\test\self-check.mjs          # 探针能读到什么
node E:\dsh-workspace\dsh-automation-monitor\test\self-check-apply.mjs    # host 只注册一个接口
node E:\dsh-workspace\dsh-automation-monitor\test\self-check-client.mjs   # 标签页注册 + 首屏渲染
```

（`node` 用 DSH 自带的：`E:\dsh-home\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）

## 用

- 会话头部点「自动化」。
- 点任意一行展开详情（排期、自动评论开关、最近日志、数据源路径）。
- 打开时每 20 秒自动刷新，也可以点右上角「刷新」。
- 状态标签：<span>已排期</span>（蓝）/ <span>运行中</span>（绿）/ 空闲（灰）/ 已停用（暗）。

## 加一条新自动化

编辑 `$DSH_HOME/automations.json`（没有就从插件目录复制一份）：

```json
{
  "items": [
    {
      "id": "backup",
      "name": "夜间备份",
      "kind": "脚本",
      "enabled": true,
      "scheduleText": "每天 03:00",
      "lastRun": "2026-10-27T19:00:00Z",
      "nextRun": "2026-10-28T19:00:00Z",
      "costText": "不花 token",
      "note": "每天凌晨把项目打包到 D 盘"
    }
  ]
}
```

存盘后刷新标签页就能看到。

## 加一个新探测器（自动读）

`lib/index.js` 里有一个 `probes` 数组，每个探针是 `(nowMs) => item[]`：

```js
const probes = [
  ['bili-scroll', probeBili],
  ['schedule', probeSchedule],
  ['task-board', probeTaskBoard],
  ['custom', probeCustom],
  // 加一行：['my-source', probeMySource],
]
```

每个 item 的字段：

| 字段 | 说明 |
|---|---|
| `id` `name` `kind` | 标识、显示名、分类 |
| `enabled` | 是否启用（false 显示为已停用） |
| `state` | `running` / `scheduled` / `idle` / `disabled` |
| `stateText` | 状态中文标签 |
| `scheduleText` | 排期描述 |
| `lastRunText` `nextRunText` | 上次 / 下次（已格式化的中文） |
| `costText` `detail[]` `lastLog` `sourceFile` | 花费、详情行、最近日志、数据源路径 |

## 接口

| 路由 | 用途 |
|---|---|
| `GET /automation/status.json` | 全部条目的 JSON（可直接 curl，只读） |

## 边界

- **只读**：所有探针只 `readFileSync`，没有任何写入；标签页也不会启动/暂停/修改任何任务。
- **失败不拖累宿主**：探针异常只进 `warnings`；标签页 fetch 失败只显示一行提示，不影响会话本身。
- **不引第三方依赖**：host 侧纯 Node，浏览器侧只用宿主自带的 `react`。
