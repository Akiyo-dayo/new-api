# Claude 主题素材来源

本目录素材用于 Claude 主题（预设 `claude`）。Claude 娘的角色形象与原图著作权归画师 ZipZipPipe（胖次狐，<https://space.bilibili.com/4168597>）所有。画师已同意本站在免费主题中使用，条件是在角落注明来源：凡是显示这些图片的页面，主题都会在角落显示一行署名「Claude 娘 © ZipZipPipe（胖次狐）· 表情 CrossPet」。不得用这些图片盈利，也不得把它们当作本仓库的开源内容再分发。

导出时只做了裁切、等比例缩放、去背景和 WebP 编码，没有用生成式放大或生成内容替代原图。去背景全部在本地完成（rembg `isnet-anime` 模型与泛洪填充对照，见 `theme-review/claude/cutouts/` 的对比图），没有调用外部服务。

## 画师原图（ZipZipPipe）

| 导出文件              | 来源                                                                                                                                                                                                                                                                                                                                  | 原图规格    | 处理                                          | 用途           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------- | -------------- |
| `claude-splash.webp`  | 原图「立绘_橘发持书」，原帖 <https://www.bilibili.com/opus/1233069202138464289>；文件取自 [lmy414/ai-chan-sheets](https://github.com/lmy414/ai-chan-sheets/blob/main/%E5%8F%82%E8%80%83%E5%8E%9F%E5%9B%BE/11_Claude%E5%A8%98_Anthropic/%E5%8E%9F%E5%9B%BE_%E7%AB%8B%E7%BB%98_%E6%A9%98%E5%8F%91%E6%8C%81%E4%B9%A6.jpg) 的 `参考原图/` | 3072 × 5504 | 缩小一半后 rembg 去白底，裁边，缩放到 1500 高 | 首页全身立绘   |
| `claude-icon.webp`    | 同上                                                                                                                                                                                                                                                                                                                                  | 3072 × 5504 | 头部裁切，奶油色底，512 × 512                 | Logo／favicon  |
| `claude-convene.webp` | 原图「4K壁纸_抬头望天」，原帖 <https://www.bilibili.com/opus/1239937623660691478>；使用用户提供的高清版 `9.webp`                                                                                                                                                                                                                      | 2000 × 1125 | 转码                                          | 登录／注册背景 |
| `claude-key-art.webp` | 同上                                                                                                                                                                                                                                                                                                                                  | 2000 × 1125 | 裁出 2000 × 600 的横带，缩放到 1600 × 480     | 仪表盘横幅     |

只用了画师原图。`ai-chan-sheets` 仓库里补全的三视图、表情板等第三方二创没有使用。

## 表情（CrossPet）

作者 CrossPet (lokicorvus)，CC BY-NC-SA 4.0，项目 <https://github.com/lokicorvus/crosspet>。均已缩放/转码（高 400px，WebP）。

| 导出文件                | 原文件                                                                                                          | 原图规格  | 用途                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | --------- | -------------------------- |
| `greet-morning.webp`    | [greet_morning.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/greet_morning.webp)     | 572 × 640 | 仪表盘横幅问候（5–11 点）  |
| `greet-noon.webp`       | [greet_noon.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/greet_noon.webp)           | 570 × 640 | 仪表盘横幅问候（11–13 点） |
| `greet-afternoon.webp`  | [greet_afternoon.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/greet_afternoon.webp) | 570 × 640 | 仪表盘横幅问候（13–18 点） |
| `greet-evening.webp`    | [greet_evening.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/greet_evening.webp)     | 571 × 640 | 仪表盘横幅问候（18–22 点） |
| `greet-night.webp`      | [greet_night.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/greet_night.webp)         | 566 × 640 | 仪表盘横幅问候（22–5 点）  |
| `sticker-sleeping.webp` | [sleeping-2.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/sleeping-2.webp)           | 571 × 640 | 通用空状态                 |
| `sticker-reading.webp`  | [reading-2.webp](https://github.com/lokicorvus/crosspet/blob/main/characters/claude/reading-2.webp)             | 570 × 640 | 关于页／节点状态页页头     |

## 表情包（用户提供，作者待确认）

四张表情包由用户提供，作者待确认。原文件先复制到了仓库外的 `theme-review/_src/claude/`，再在本地去掉底色。每张都做了 rembg 与泛洪填充两个版本，默认采用边缘更干净的泛洪版；要换成 rembg 版，只需把对应的 `*-rembg.png` 按同样的尺寸导出，覆盖同名文件即可。

| 导出文件                    | 原文件   | 原图规格    | 去底方式                                       | 用途                       |
| --------------------------- | -------- | ----------- | ---------------------------------------------- | -------------------------- |
| `claude-sprite.webp`        | `4.webp` | 1254 × 1254 | 泛洪去白底 + 描边外缘去色                      | 侧边栏小卡、sprite         |
| `sticker-account-gone.webp` | `5.png`  | 170 × 152   | 泛洪去蓝灰底与白色贴纸边，底边裁 7px           | 404 页（显示宽度 ≤ 140px） |
| `sticker-ban-bubble.webp`   | `6.png`  | 512 × 512   | 泛洪去黑底，保留对话气泡，清掉发缝里的黑底残留 | 关于页底部彩蛋             |
| `sticker-whale.webp`        | `7.webp` | 1080 × 1080 | 泛洪去黑底，保留深色描边                       | 空表格                     |

`claude-emblem.svg` 是本主题自绘的柔和星芒（中心小圆加九道长短粗细略有变化的放射线），没有描摹任何官方 Logo。
