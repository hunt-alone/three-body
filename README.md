# 三体问题 | Three-Body Real-time Simulation

基于 Three.js 的实时三体引力模拟，支持作为 macOS 桌面壁纸运行。

![Three-Body](https://img.shields.io/badge/Three.js-r183-blue) ![React](https://img.shields.io/badge/React-19-blue) ![Vite](https://img.shields.io/badge/Vite-8-purple)

## 特性

- **真实 3D 渲染** — Three.js PerspectiveCamera + UnrealBloomPass 后处理辉光
- **Yoshida 4th-order 辛积分器** — 高精度物理模拟，3 恒星 + 1 行星
- **入场动画** — 相机从近处拉远，天体渐入视野
- **交互** — 鼠标拖拽旋转视角，光标跟随漂移
- **实时数据面板** — 恒纪元/乱纪元、脱水/浸泡、行星表面温度、α β γ 距离条
- **文明记录** — 每次发散代表一次文明毁灭，记录文明编号和存续年数
- **ESO 银河全景背景** — 真实天文照片 equirectangular 映射
- **设置抽屉** — 质量、时间尺度、轨迹、辉光强度、星芒、相机距离、背景切换
- **数据持久化** — 所有设置和文明数据存储在 localStorage
- **Übersicht 桌面壁纸** — 一键打包为 macOS 桌面 widget

## 快速开始

### 开发模式

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`

### 构建

```bash
npm run build
```

## 作为 macOS 桌面壁纸使用

### 1. 安装 Übersicht

[Übersicht](http://tracesof.net/uebersicht/) 是一个 macOS 桌面 widget 引擎，可以在桌面上渲染 HTML/CSS/JS 内容。

**下载安装：**

- 访问 http://tracesof.net/uebersicht/
- 下载 `.dmg` 文件
- 拖拽 Übersicht.app 到 Applications 文件夹
- 启动 Übersicht，菜单栏会出现 Ü 图标

**首次设置：**

1. 启动后，点击菜单栏 **Ü** 图标
2. 选择 **Open Widgets Folder** — 记住这个目录路径
3. 如需 widget 交互（拖拽旋转、打开设置），在 **Preferences → Interaction Shortcut** 设置快捷键

### 2. 生成 Widget

在项目目录运行：

```bash
npm run deploy
```

这会：
- 构建项目为单个 HTML 文件（JS/CSS/图片全部内联）
- 生成 `three-body.widget/` 目录

### 3. 部署到 Übersicht

```bash
cp -r three-body.widget ~/Library/Application\ Support/Übersicht/widgets/
```

Übersicht 会自动检测并加载。如果没有显示，点击菜单栏 **Ü → Refresh All Widgets**。

### 4. 后续更新

修改代码后，只需更新 HTML 文件：

```bash
npm run deploy
cp three-body.widget/lib/index.html ~/Library/Application\ Support/Übersicht/widgets/three-body.widget/lib/
```

### Widget 结构

```
three-body.widget/
├── index.jsx          ← Übersicht widget 入口
└── lib/
    └── index.html     ← 单文件应用（~1.3MB，全部内联）
```

## 操作说明

| 操作 | 说明 |
|------|------|
| 拖拽 | 旋转 3D 视角 |
| 鼠标移动 | 视角轻微跟随光标（可在设置中关闭） |
| ⚙ 按钮 | 打开设置抽屉 |
| 重置 | 重新生成星系，文明编号 +1 |
| 恢复默认 | 重置所有设置和文明编号 |

## 数据面板说明

| 数据 | 含义 |
|------|------|
| 恒纪元 / 乱纪元 | 温度稳定且宜居 = 恒纪元；温度剧烈波动或极端 = 乱纪元 |
| 浸泡 / 脱水 | 温度 -10°C ~ 45°C = 浸泡（宜居）；超出范围 = 脱水（生存模式） |
| 温度 | 基于 Stefan-Boltzmann 辐射模型计算的行星表面温度 |
| α β γ | 行星到三颗恒星的实时距离 |
| 文明编号 | 每次系统发散（文明毁灭）后累加 |
| 存续年数 | 当前文明运行时间（1 模拟秒 ≈ 120 年） |

## 设置项

| 分组 | 设置 | 说明 |
|------|------|------|
| 模拟 | 时间尺度 | 模拟速度 0.5x ~ 10x |
| | 轨迹长度 | 拖尾点数 50 ~ 800 |
| | 显示轨迹 | 开关拖尾显示 |
| 天体质量 | 恒星 1/2/3 | 三颗恒星质量（默认 10/10/7） |
| | 行星 | 行星质量 |
| 视觉 | 光标跟随旋转 | 开关鼠标跟随漂移 |
| | 跟随速度 | 漂移灵敏度 |
| | 辉光强度 | Bloom 后处理强度 0 ~ 3 |
| | 恒星星芒 | 开关四尖星芒效果 |
| 视角 | 距离 | 相机距离倍率 0.3x ~ 3.0x |
| 背景 | 实景 / 星云 / 纯黑 / 深蓝 / 自定义 | 5 种背景模式 |
| 引力 | 软化距离 / 倍数 / 发散阈值 / 约束力 / 约束距离 | 高级物理参数 |

## 技术栈

- **React 19** + **TypeScript** + **Vite 8**
- **Three.js r183** — WebGL 3D 渲染
- **EffectComposer** + **UnrealBloomPass** + **OutputPass** — 后处理管线
- **Yoshida 4th-order Symplectic Integrator** — 物理积分（能量守恒）
- **vite-plugin-singlefile** — 单文件构建（用于 Übersicht widget）

## 致谢

- 背景全景图：[ESO/S. Brunier (eso0932a)](https://www.eso.org/public/images/eso0932a/) — Creative Commons Attribution 4.0
- 灵感来源：Wallpaper Engine--三体问题 | Three-Body 实时演算、刘慈欣《三体》
