# 工作台提交与合并指南

这份指南适用于本仓库维护者和外部贡献者。公开仓库不等于所有人都能直接修改：只有仓库拥有者和被授权的协作者可以向原仓库推送分支；其他人通过 Fork 和 Pull Request（简称 PR）提交。

## 分支怎么用

| 分支 | 用途 |
| --- | --- |
| `main` | 稳定主线。经过验证、准备交付的代码放在这里。 |
| `dev` | 开发集成分支。日常功能和修复先合入这里，集中测试后再合入 `main`。 |
| `feat/名称` | 从 `dev` 拉出的功能分支，例如 `feat/panel-export`。 |
| `fix/名称` | 从 `dev` 拉出的修复分支，例如 `fix/login-session`。 |
| `docs/名称` | 从 `dev` 拉出的文档分支，例如 `docs/setup-guide`。 |

正常路线：`功能或修复分支 → PR → dev → 验证 → PR → main`。这里是协作约定；是否已配置 GitHub 分支保护，以仓库设置为准。

## 有仓库写入权限：提交一个改动

在 PowerShell 或终端中执行。把 `feat/panel-export` 和 `具体文件` 换成自己的分支名和文件路径；每次开发使用新的分支。

```powershell
git clone https://github.com/shiqiandiandianda/manga-production-workbench.git
cd manga-production-workbench
git fetch origin
git switch -c feat/panel-export origin/dev

# 修改文件，并运行与改动相称的测试后：
git status
git diff
git add 具体文件
git diff --cached
git commit -m "feat: 改进长图导出"
git push -u origin feat/panel-export
```

打开 GitHub 仓库的 **Pull requests → New pull request**：目标分支（base）选 `dev`，来源分支（compare）选 `feat/panel-export`。填写做了什么、为什么、测试结果及尚未验证的内容，提交给维护者审核。

`git add` 建议明确写文件路径。不要用 `git add .` 把自己的工程、生成图片、账号、Cookie、密钥或本机运行数据一起提交。

## 外部贡献者：Fork 后提交

1. 在 GitHub 点击仓库页面右上角 **Fork**，把仓库复制到自己的账号。
2. 克隆自己的 Fork，然后把原仓库登记为 `upstream`；将 `你的用户名` 替换成自己的 GitHub 用户名。

```powershell
git clone https://github.com/你的用户名/manga-production-workbench.git
cd manga-production-workbench
git remote add upstream https://github.com/shiqiandiandianda/manga-production-workbench.git
git fetch upstream
git switch -c fix/login-session upstream/dev

# 修改并测试后：
git status
git diff
git add 具体文件
git diff --cached
git commit -m "fix: 修复登录会话"
git push -u origin fix/login-session
```

3. 在 GitHub 创建 PR，选择 **compare across forks**：目标仓库为原仓库、目标分支为 `dev`；来源仓库为自己的 Fork、来源分支为 `fix/login-session`。

## 提交信息怎么写

每次提交尽量只处理一件事，写明行为变化。常用前缀：`feat:` 新功能、`fix:` 修复、`docs:` 文档、`test:` 测试、`refactor:` 重构、`chore:` 工具或维护。例如 `fix: 避免切换话时丢失资产筛选`。

## 测试要求

进入 `comic` 目录，在准备好 Node 24、Python、Canvas、Playwright 和浏览器后运行：

```powershell
cd comic
npm run test:small
# 后端、协议、数据或大范围修改，再运行：
npm run test:large
```

小改动至少运行核心功能和核心链路；后端、协议、数据或大范围改动运行全量测试。测试报告保存在 `verification/quality-runs/`，失败、超时和跳过都要说明。

现有部分旧测试仍含本机绝对路径、专用资料或模型依赖，换电脑时需要调整测试环境；运行失败时在 PR 中写明具体阻碍，不把未执行的项目算作通过。测试必须使用隔离数据和合成账号，不连接生产墨库、不发起真实付费生图。更多说明见 [测试说明](comic/quality/使用说明.txt)。

## 维护者怎么合并

1. 审核改动、测试记录及冲突，检查没有提交账号、项目数据和未经授权的素材。
2. 在功能 PR 中确认目标是 `dev`；验证通过后可选择 **Squash and merge**，把这次功能整理成一个提交。
3. 一批改动在 `dev` 完成联测后，新建 PR：base 选 `main`，compare 选 `dev`。写明本批变化、测试和已知限制。
4. 审核通过后可选择 **Create a merge commit**，保留 `dev` 的集成历史。合并后再按实际发布流程交付；GitHub 合并本身不会自动部署工作台。

如 `dev` 和 `main` 均有新提交，先解决冲突再合并。不要通过强制推送覆盖别人已提交的历史。

## 分支冲突怎么处理

在自己的功能分支上，将目标 `dev` 的最新提交合入，逐个解决冲突，重新测试后推送：

```powershell
git switch feat/panel-export
git fetch origin
git merge origin/dev
# 编辑冲突文件并确认后：
git add 具体冲突文件
git commit
git push
```

Fork 贡献者应改为 `git fetch upstream` 和 `git merge upstream/dev`。如果不知道冲突该保留哪一部分，先在 PR 中说明，避免覆盖已有功能或工程兼容逻辑。

`main` 的紧急修复由维护者从 `main` 建立修复分支，经 PR 合入 `main` 后，再将该修复合回 `dev`，避免两个分支遗漏修复。

## 本地数据与授权

不要提交 `runtime-data/`、`.runtime/`、个人配置、生产日志、用户项目、原图、访问令牌或密码。提交新的字体、图片和其他第三方素材前，确认有公开分发的权利并附上许可信息。本仓库的代码许可证以仓库中明确提供的许可证文件为准。
