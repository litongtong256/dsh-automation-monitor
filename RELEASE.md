# 发布规矩（给 AI / 维护者自己看）

> 这条是项目所有者明确要求的：**每次改完都必须告诉他一共传了哪里、传成没成。**

## 改完代码的固定流程

```bash
NODE=/e/dsh-home/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe
PNPM=/e/dsh/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs
cd <本目录>

# 0. 改完先自检
"$NODE" --check lib/index.js
"$NODE" --check lib/client.js
"$NODE" test/self-check.mjs
"$NODE" test/self-check-apply.mjs
"$NODE" test/self-check-client.mjs
"$NODE" test/discovery-check.mjs

# 1. 升版本（npm 不允许覆盖已发布的版本号）
#    修 bug → patch；加功能 → minor

# 2. 提 GitHub
git add -A
git -c user.name=litongtong256 -c user.email=2353682040@qq.com commit -m "fix: ..."
git pull --rebase origin main      # 用户可能在网页上改过 README
git push origin main

# 3. 发 npm
"$NODE" "$PNPM" publish --no-git-checks --no-color --access public

# 4. 同步本地 profile 里登记的版本号
#    E:\dsh-home\profiles\desktop\package.json → dependencies['dsh-automation-monitor']
#    注意：该文件带 UTF-8 BOM，读写都要处理
```

## 必须在回复里写出来

每次交付的结尾固定加一段，**不许省略**：

> 📤 **已上传**
> - GitHub：`<commit 短 hash>` — <提交信息摘要>
> - npm：`<版本号>`（https://www.npmjs.com/package/dsh-automation-monitor）
> - 本地 profile 版本：`<版本号>`
> - 需要重启 DSH 才生效？需要 / 不需要（client 端改动必须重启；纯后端理论上热加载，以实测为准）

## 为什么

用户是项目所有者，但看不懂代码。他判断「改没改好」的唯一依据就是**你说了传没传**。
说了「改好了」却没说「传到哪了」，对他来说等于没做完。

## 另外几条硬规矩

- **不要在 profile 里跑 `npm install` / `pnpm add`** —— 会把 `node_modules/dsh-automation-monitor` 这个 junction 重链成 npm 包，本地改动就丢了。
- `client.js` 是浏览器半端，改动**必须重启 DSH** 才生效（启动时一次性注入）；`index.js` 是宿主半端，cordis 有时会热加载，但不保证。
- 版本号要跟 npm 上一致；`package.json` 的 `version` 和三处引用别漏。
