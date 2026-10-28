# 贡献说明

## 分支用途

- `main`：经过验证的稳定代码。更新此分支不等于已经在任何人的电脑或服务器部署。
- `dev`：团队集成分支，合并各项经过测试的修改。准备发布时再把验证过的 `dev` 合入 `main`。
- 个人工作分支：从最新 `dev` 创建，例如 `alice/fix-asset-search`；多人分别开发，避免直接覆盖彼此的提交。

请先备份本机改动，在独立目录开发。提交前检查代码及文件清单，不得提交工程、制作参考、图片、字体、模型、运行环境、账号、会话、令牌或团队配置。

测试使用合成资料和隔离环境；不要连接生产账号或发起真实付费生图。记录失败、超时与跳过的项目。团队上线和升级须使用既有授权发布流程，且先确认没有进行中的任务。

## 创建工作分支并提交

首次使用时克隆仓库；已有仓库可从 `git switch dev` 开始。以下命令在 PowerShell 或 Git Bash 中执行：

```sh
git clone https://github.com/shiqiandiandianda/manga-production-workbench.git
cd manga-production-workbench
git switch dev
git pull --ff-only origin dev
git switch -c alice/fix-asset-search
```

将分支名换成自己的名称。修改完成后先在 `comic` 目录按 [测试说明](comic/quality/README.md) 配置隔离依赖：小改动运行 `npm run quality:small`，大改动运行 `npm run quality:large`。失败、阻断、跳过和不稳定都需要如实记录，不能作为通过。

回到仓库根目录，按实际修改的文件逐个暂存；下面的文件名只是示例，须替换为自己的文件：

```sh
git status --short
git add -- comic/public/example.js comic/tests/example.test.mjs
git diff --cached --stat
git diff --cached --check
git commit -m "Describe the change"
git push -u origin alice/fix-asset-search
```

确认暂存内容不含制作资料、密钥或运行数据后提交。在 GitHub 创建从个人分支到 `dev` 的 Pull Request，写明修改内容和测试结果；检查通过后再合并。若其他人更新了 `dev`，先在个人分支运行 `git fetch origin`、`git merge origin/dev`，解决冲突并重跑受影响测试，再推送；不要强制推送覆盖别人的提交。

## 将 dev 合入 main

确认 `dev` 的目标提交、核心测试结果及尚未验收事项后，在 GitHub 创建从 `dev` 到 `main` 的 Pull Request。审查并合并后，检查 `main` 的实际提交。若由本人在本地进行快进合并，先确认工作区没有未保存的修改，并确保 `main` 是 `dev` 的祖先：

```sh
git fetch origin
git merge-base --is-ancestor origin/main origin/dev
git switch main
git pull --ff-only origin main
git merge --ff-only origin/dev
git push origin main
```

若祖先检查或快进合并失败，说明分支已有分叉；先审查和解决差异，不使用 `--force`、`reset --hard` 或删除仓库来覆盖历史。更新分支后，各成员再按各自环境和权限部署，不提交本机配置或生产资料。
