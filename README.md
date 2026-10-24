# 知行

学生用的本地学习与协作工具。学习区有 AI 导师、文件库、思维导图和论文文库；工作区把任务交给模型协作，再由 WorkBuddy 或 DeepSeek Harness 落地。界面用 Next.js、TypeScript 和 Primer React。

## 共同创作者 / Co-creators

- Grok Bot
- Claude

发布者：陈星行（hakimi-ctx）。仓库所有者与发布者，不列为上述 AI 共同创作者。

Publisher: Chen Xingxing (hakimi-ctx) — owner/publisher, not listed as an AI co-creator above.
## 本地运行

需要 Node.js 20 或更高版本，以及 pnpm。

```bash
pnpm install
pnpm dev
```

浏览器打开终端里打印的本机地址，进入 `/study`。

Windows 上也可以双击 `Start-Zhixing.bat`。它会检查 Node.js、安装依赖，并在本机启动后打开浏览器。默认端口是 3939。

桌面窗口、安装包和免安装版见《Windows 打包与启动说明.md》。

## 数据

配置、文件库和对话都在用户目录的 `Zhixing` 文件夹（Windows 是 `%USERPROFILE%\Zhixing`），不在项目目录里。可以用环境变量 `ZHIXING_HOME` 改位置。

