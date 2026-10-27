# 漫画工作台测试合集

本合集基于 `dev` 源码建立。先阅读 [功能与链路清单](功能与链路清单.md)：标记“强感知”的是影响日常制作的功能，标记“核心链路”的是日常必须可走通的任务。[自动化用例索引](自动化用例索引.md) 列出静态发现的测试标题，[墨库对接与版本说明](墨库对接与版本说明.md) 说明上传身份和正式版本规则，[全量测试盘点](全量测试盘点-2026-10-28.md) 和 [非通过文件清单](全量失败清单-2026-10-28.md) 保存尚需核查的结果。清单里的测试引用是文件级关联，不能当作逐个动作已经验收。

## 如何选择

在仓库的 `comic` 目录运行：

| 场景 | 命令 | 范围 |
| --- | --- | --- |
| 小改动提交前 | `npm run quality:small` | 核心功能和核心链路，去重后执行 |
| 大改动或准备发布 | `npm run quality:large` | 仓库中自动发现的测试文件和登记的全部链路测试 |
| 只看核心功能 | `npm run quality:core-functions` | `suites.json` 指定的核心功能测试 |
| 只看全量功能 | `npm run quality:all-functions` | 所有发现的 JS、Python 测试文件 |
| 只看核心链路 | `npm run quality:core-flows` | `catalog.mjs` 中标记核心的链路测试 |
| 只看全部链路 | `npm run quality:all-flows` | `catalog.mjs` 登记的全部链路关联测试 |

`npm run test:small` 和 `npm run test:large` 分别是小改动、大改动入口的别名。

例如：

```powershell
cd .\comic
npm run quality:small
npm run quality:large -- --jobs 2 --timeout 150
```

默认一次只跑一个测试文件；`--jobs 2` 使用两份隔离源码副本。`--timeout` 单位为秒。默认结果写到仓库上级目录的 `q/<时间>-<进程号>/`，可用 `--output` 指向**不存在的新目录**。运行结束后打开终端输出的 `report.html`，并查看 `results.csv`、各文件日志和 `coverage.json`。`inventory.json` 记录选中的文件。

复制源码前及每个测试文件启动前，检查输出盘和源码所在盘的剩余空间；任一盘低于 3 GiB 时停止，并在 `results.json` 的 `stoppedReason` 记录原因。无法启动测试子进程时，运行器记录阻断并停止排队，不把未运行的文件记成业务失败。这些中断不算通过；单个测试仍需控制自己的磁盘使用。

以下旧用例即使使用隔离资料，也会使用管理员凭据或执行管理员操作，运行器在启动之前将它们标为 `blocked`，不计为通过：`center/tests/http.test.mjs`、`comic/tests/asset-center.integration.test.mjs`、`comic/tests/asset-generator.integration.test.mjs`、`distribution/tests/forced-upgrades.test.mjs`、`distribution/tests/rolling-upgrades.test.mjs`、`distribution/tests/publisher-admin-page.test.mjs`、`distribution/tests/publication.test.mjs` 和 `协作/tests/hub-server.test.mjs`。这些能力需要另行获得针对具体权限和操作的授权后才能验证。其他用例仍须事先审查其依赖和权限。

仅查看计划，不执行：

```powershell
node quality/run.mjs --suite small --list
```

只排查某个文件：

```powershell
node quality/run.mjs --suite small --filter moku-http-flow
```

`--filter` 只是排查工具，不代表整套测试已经执行。失败、超时、跳过、待办、零测试、安全拦截、不稳定或未完成都不算通过。隔离浏览器在打开页面前若出现指定的临时配置目录启动错误，会重试一次；重试后完成则标为 `flaky`，不会被当作干净通过。全量套件中保留原有历史测试，若它们引用已删除的独立修图服务，会作为失败列出；当前同页修图另有 `repair-integrated.test.mjs` 和 `repair-composition.test.mjs`。不要删除失败测试来制造通过。

用户已确认团队帮忙生图保持默认关闭。`team-help-disabled.test.mjs` 检查旧页面及接口返回 410、没有新增任务；历史团队接单用例仍保留在全量盘点中，但其要求启用已关闭功能，失败不作为恢复该功能的依据。其他非通过用例仍需逐项核实。

长套件可用 `node quality/run.mjs --suite large --list` 查看排序，再以 `--start 0 --end 40` 等不重叠区间分别运行，结束序号不包含在区间内。每段必须使用同一源码版本，并汇总所有区间；单段报告标记为部分运行。若期间修改源码，受影响测试必须在最终版本重新运行。

真实制作资料的原有跳过项单列在 `comic/tests/production-real-data.test.mjs`，保留在全量功能／大改动套件中，等待独立授权与测试资料；它不阻断只使用合成资料的核心套件。该项跳过时仍会让全量套件未通过。

## 依赖与隔离

需要 Node.js 24 或更新版本、Python、Playwright、`@napi-rs/canvas`、可用的 Chromium 系浏览器，以及相关 Python 图像库。核心与全量测试包含本地墨库源码联调，需提供带 `node_modules` 和 PGlite 的墨库测试源码；没有时该用例会明确失败，不伪装成通过。运行器默认查找当前用户 Codex 工作区的依赖；同事机器没有该目录时，可指向自己的**测试用依赖**：

```powershell
$env:QUALITY_NODE_MODULES = 'D:\test-dependencies\node_modules'
$env:QUALITY_PYTHON = 'D:\test-dependencies\python\python.exe'
$env:QUALITY_TEST_FONT = 'C:\Windows\Fonts\arial.ttf'
$env:QUALITY_MOKU_SOURCE = 'D:\moku-test-source'
$env:QUALITY_U2NET_MODEL = 'D:\test-dependencies\u2net.onnx'
$env:QUALITY_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run quality:small
```

`QUALITY_NODE_MODULES` 目录应包含 `playwright` 和 `@napi-rs/canvas`。`QUALITY_MOKU_SOURCE` 支持构建号 `1.1.0-20261027-global1` 或 `2.0.1-20261028-recovery1`，并须包含测试依赖；运行器复制源码到本次测试目录、使用对应的 schema 23 或 24 创建独立 PGlite 数据库与普通合成账号。测试报告和 `inventory.json` 会记录实际版本；更换墨库版本时先更新和验证契约，不要绕过版本检查。如 OpenCV 等 Python 包安装在单独目录，用 `QUALITY_PYTHON_DEPS` 指定；默认也会检查仓库根目录未提交的 `.quality-deps/python`。测试字体只在运行时读取，不进入仓库。可用 `QUALITY_BROWSER_EXECUTABLE` 指定本机浏览器；设置后所有浏览器测试会使用它，报告结论只适用于指定浏览器。未设置时保留用例指定的浏览器，无指定时 Windows 默认 Edge。

本地图像处理测试需要额外的 OpenCV 和 ONNX Runtime。可将专用测试依赖安装在仓库外的独立目录，然后在运行测试前设置 `QUALITY_PYTHON_DEPS`，例如在 `comic` 目录执行：

```powershell
& $env:QUALITY_PYTHON -m pip install --target D:\test-dependencies\image-python -r quality\requirements-test-image.txt
$env:QUALITY_PYTHON_DEPS = 'D:\test-dependencies\image-python'
```

先设置前文的 `QUALITY_PYTHON`；这里的安装目录仅用于测试，不修改应用的 Python 环境。测试 U²-Net 还需要另行提供并校验下述模型文件。

本地抠图模型测试可通过 `QUALITY_U2NET_MODEL` 指向已提供的 U²-Net 模型。运行器校验模型 MD5 为 `60024c5c889badc19c04ad937298a77b` 后复制到隔离源码目录；不提交模型，不接触真实图片。未指定时相应用例明确报告缺少模型。

运行器复制源码，建立独立 HOME、配置、临时目录及合成资料；测试进程只可连接本次登记的回环服务，浏览器使用限制代理；文件读取限制在隔离目录及声明的测试依赖、字体内，写入只允许隔离目录；常见真实生图 CLI 和管理员工具会被拦截。该防护属于普通用户态防误操作，**不等于操作系统级沙箱**，原生扩展及子进程不受全部钩子约束，只运行可信且已审查的测试文件。不要把真实账号、Token、项目或生产图片放入测试目录。

墨库测试包括合成 HTTP 服务，以及工作台连接所选墨库版本实际代码的合成数据库闭环；覆盖认证 OpenAPI、登录与退出、会话失效及账号切换、分类、无后缀图片、四类全局素材、上传重试、追加版本、分页历史、固定版本和工程读回。制作资料扫描在读取期间绑定会话；旧预览在会话切换后失效，导入前再次验证登录。正式版本另覆盖实际工作台 HTTP 路由提交、历史及恢复；批量操作覆盖跨页选择、回收恢复、并发冲突及回执丢失后的刷新重试。它们不证明生产墨库的所有接口兼容。生产联调需要普通制作账号、独立测试项目和当前服务的认证 OpenAPI；只能在明确授权的测试资料上验证。真实付费生图、跨机协作、生产数据、性能和部署均不在自动通过结论内。

破框前景的来源指纹现在包含画面设计。旧版未记录完整来源的待采用候选仍保留，但需要重新生成并核验；已采用的旧图层不会因更新被删除。

## 维护清单

`catalog.mjs` 是功能和链路的登记来源，`suites.json` 维护核心功能文件。增加或修改功能时，同步填写入口、源码、关联测试和边界，再执行：

```powershell
npm run quality:catalog
```

生成器检查引用文件是否存在并更新清单。新增功能若还没有独立断言，应明确写“未建立自动测试”，不能因为某个相邻测试文件通过就算完成。
