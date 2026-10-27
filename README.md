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

> **装完打开是空的？** 这四条来源都是「有就显示、没有就跳过」。
> 你要是没装 `dsh-bili-scroll`、也没建过日程提醒，打开就是空的 —— 不是插件坏了，是确实没东西可监视。
> 可以往 `automations.json` 里手动登记几条（见下面「加一条新自动化」）。

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

## 安装

> **Windows 用户**：仓库里带了个 `install.ps1`，跑一次就把下面第 2–4 步全做了：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install.ps1
> ```
>
> 它会自动找 `DSH_HOME`、建链接、往 `package.json` 里加两行；改之前会备份，改坏了自动还原。
> 想装到别处就加参数：`-DshHome "D:\dsh-home" -ProfileName desktop`。
>
> 手动装的话继续往下看。

> 前提：DSH 桌面版（要有 `conversation.view` 这个槽位的版本）。
> Windows / macOS / Linux 都能装，下面的路径**都是示例，照抄时换成你自己的**。

### 最省事：从 npm 装（一条命令）

包已经发在 npm 上了：<https://www.npmjs.com/package/dsh-automation-monitor>

```bash
# 先进到你的 profile 目录
cd "$DSH_HOME/profiles/desktop"        # Windows PowerShell: cd "$env:DSH_HOME\profiles\desktop"

# 装
npm i dsh-automation-monitor           # 用 pnpm 也行：pnpm add dsh-automation-monitor
```

它会被放进 `node_modules/dsh-automation-monitor`，正是 DSH 要读的位置，**不用建链接**。

然后只剩一步：打开同一个目录下的 `package.json`，在 `dsh.profile.bundles` 数组末尾加一行

```jsonc
"dsh-automation-monitor"
```

重启 DSH，会话头部就多出「自动化」标签页。

> 想改源码、或者长期用一份自己的改动，再走下面的手动流程（clone + junction）。

### 1. 先找到你的 DSH_HOME

DSH 的数据和插件都在它下面：

```powershell
# Windows PowerShell
echo $env:DSH_HOME
```

```bash
# macOS / Linux
echo $DSH_HOME
```

没设过的话默认是 `~/.dsh`（比如 `C:\Users\你的用户名\.dsh`）。
你的 profile 目录 = `$DSH_HOME/profiles/<profile 名>`，一般叫 `desktop`。

下面统一写作 `$DSH_HOME` 和 `desktop`。

### 2. 把代码放下

```bash
git clone https://github.com/litongtong256/dsh-automation-monitor.git /path/to/dsh-automation-monitor
```

放哪都行（`D:\plugins\...`、`/opt/...`、`~/code/...`），记住路径就行。

### 3. 挂进 profile 的 `node_modules`

Windows（junction，不需要管理员权限）：

```powershell
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\desktop\node_modules\dsh-automation-monitor" `
  -Target "D:\plugins\dsh-automation-monitor"
```

macOS / Linux（符号链接）：

```bash
ln -s /opt/dsh-automation-monitor \
      "$DSH_HOME/profiles/desktop/node_modules/dsh-automation-monitor"
```

### 4. 在 profile 的 `package.json` 里登记两处

打开 `$DSH_HOME/profiles/desktop/package.json`：

```jsonc
{
  "dependencies": {
    "dsh-automation-monitor": "0.2.0"     // ← 加这一行
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ... 原有的
        "dsh-automation-monitor"          // ← 数组末尾加这一行
      ]
    }
  }
}
```

### 5. 重启 DSH

会话头部多出「自动化」标签页，就是装好了。

## 卸载

```powershell
Remove-Item "$env:DSH_HOME\profiles\desktop\node_modules\dsh-automation-monitor" -Force
```

再把 `package.json` 里上面那两行删掉，重启即可。删掉链接**不会**删你 clone 下来的源码。

## 用 junction / symlink 装的原因

改代码不用重新安装，开发目录就是运行目录。代价是**别乱删别乱搬源码目录**，搬了要重建链接：

```powershell
Remove-Item "$env:DSH_HOME\profiles\desktop\node_modules\dsh-automation-monitor" -Force
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\desktop\node_modules\dsh-automation-monitor" `
  -Target "<新路径>"
```

> 也正因如此：**别在 profile 里跑 `npm install`**，它会把链接覆盖成真目录，你的改动就跟运行中的那份脱钩了。

## 自检（不用起 DSH）

进插件目录跑：

```bash
node test/self-check.mjs          # 探针能读到什么
node test/self-check-apply.mjs    # host 只注册一个接口
node test/self-check-client.mjs   # 标签页注册 + 首屏渲染
```

Node 18+ 都行。想用 DSH 自带的那个也行：`$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe`

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
