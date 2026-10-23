# 第三方代码与署名说明

本插件（`dsh-bili-scroll` / 刷B站）本体以 **MIT** 协议发布，正文见仓库根目录的 `LICENSE`。

## 内含第三方代码

- 目录：`vendor/bilibili-mcp/`
- 项目：**bilibili-mcp**
- 许可证：**MIT**，Copyright (c) 2026 AGI_Ananas
- 完整许可见该目录下的 `LICENSE`

## 关于版权署名

`LICENSE` 第一行写的是 `Copyright (c) 2026 c1overzz`。
如果你要基于本仓库做二次分发，保留这一行和 MIT 正文即可，不必另行取得授权（MIT 本身就允许改、再发、商用）。

## 本仓库（pfzlsad/dsh-bili-scroll）的修改

本仓库是 **二次修改版**，来源：原作者 **`c1overzz/dsh-bili-scroll`**（MIT，Copyright (c) 2026 c1overzz）。

截至 2026-10-23，相对原版的改动**只有「自动收藏」的两处 bug 修复**：

- `index.js`：`POST /api/bili-duty/config` 的字段白名单补上 `favFolderId`
  —— 原来设置页选中的收藏夹会被这条路由丢掉，永远是 `0`，收藏功能等于没开。
- `lib/favops.py`：收藏改用 `await Video.set_favorite(add_media_ids=[fid])`
  —— 原来调用的 `favorite_list.FavoriteListResource` 在该版本的 `bilibili-api-python` 里并不存在。

其余代码、文档、第三方组件均来自原作者；`LICENSE` 里的版权行保持原样。

---
*本文件只是说明，不构成额外限制。*