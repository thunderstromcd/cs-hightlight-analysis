# 拆片前端接口约定

本机地址为 `http://127.0.0.1:38471`。登录后，浏览器通过同源 HttpOnly 会话 Cookie 访问接口和下载成片。会话有效期为 7 天，公网 Cookie 带 `Secure`。未登录返回 **401**，从非允许源写入或通过明文公网地址访问返回 **403**。录像 `id` 和导出 `demoId` 都指向个人录像条目，访问其他账号的录像、任务详情和文件返回 **404**。

## 0. 账户

| 接口 | 请求 | 成功响应 |
| --- | --- | --- |
| `POST /api/auth/login` | `{ username, password }` | `{ user }`，设置会话 Cookie |
| `GET /api/auth/session` | 无 | `{ user }` |
| `POST /api/auth/logout` | 无 | `{ user: null }`，清除当前会话 |
| `POST /api/auth/password` | `{ currentPassword, newPassword }` | `{ user: null }`，清除该账号所有会话 |
| `POST /api/admin/users` | `{ username, password }` | **201** `{ user }`，仅管理员 |

`user` 包含 `id`、`username`、`role`（`admin | member`）与 `preferredSteamId`（未绑定为 `null`）。登录超过速率限制返回 **429**。

导出请求体保持不变：

```json
{
  "demoId": "uuid",
  "highlightIds": ["kind:steamId:round:tick"],
  "options": { "showXRay": false, "perspective": "player" }
}
```

`options` 可省略，默认 `showXRay: false`、`perspective: "player"`。传 `"enemy"` 时，每段先播击杀者视角，随后为有可用受害者镜头的片段追加同一段回放，再继续下一段。没有可用镜头的片段只播放原视角。其它值返回 **400**，`message` 为「视角只能是 player 或 enemy。」

页面不要读取或展示 `victimSteamId` 等内部字段名。服务端在面向页面的 JSON 里会去掉该字段。

---

## 1. 上传与解析进度

### `POST /api/demos`

- `multipart/form-data`，字段名 `file`，只接受 `.dem`，最大 1 GB。
- **上传进度请用 `XMLHttpRequest` 的 `upload.onprogress`**（`fetch` 看不到上行进度）。同源会话适用同一上传接口。
- 可直接调用 `src/lib/client.ts` 里的 `uploadDemo(file, onProgress)`。
- 服务端在收完全部请求体后才会返回。进度条到 100% 后可能还会短暂等待写入，属正常现象；收到 **201** 后改轮询解析状态。
- 201 响应：

```json
{
  "demo": {
    "id": "b18620eb-1016-41a9-8e72-9d0bc3e8587c",
    "originalName": "match.dem",
    "status": "analyzing",
    "error": null,
    "progress": {
      "phase": "analyzing",
      "percent": null,
      "message": "正在解析录像，找出高光片段…"
    },
    "victimPerspective": { "available": false, "message": null }
  }
}
```

`progress.phase` 为 `uploading | downloading | extracting | analyzing | ready | error`。`percent` 可能为 `null`（没有精确百分比时请只展示文案）。`message` 为人话中文。

### `POST /api/demos/import`

仅支持 5E，认证方式与上传接口相同。JSON 请求体：

```json
{ "link": "【5E对战平台：thunderstorm23的比赛详情页】https://csgo.5eplay.com/app/share_loding_type11?domain=thunderstorm23&matchcode=g161-b-20261124220717909434665&uuid=abbfff05-dee2-11ea-a071-ec0d9a718678" }
```

`link` 接受分享链接、完整分享文案或 5E 对局 ID；分享链接只读取 `matchcode`，不请求分享页。

- 新建个人录像条目返回 **201**，当前账号已导入同场时返回 **200**，`reused: true`。响应为 `{ demo, reused }`，`demo` 增加 `importedFrom: { platform: "5e", matchId: "…" }`。
- 下载、解压在后台执行，`demo.status` 和 `progress.phase` 依次为 `downloading → extracting → analyzing → ready`，失败为 `error`。用原有详情接口轮询直到 `ready` 或 `error`。
- 下载进度按文件响应的长度计算，未提供长度时 `percent: null`。ZIP 和解压后的 `.dem` 均限制 1 GB。
- 同一 5E 对局由本机共享下载、解压和解析，每个账号有自己的录像条目。同一账号重复导入会复用其已有条目。失败后重新提交同一链接可重试。
- 链接不合法返回 **400**：`{ error: "import", message }`；录像不可用、下载或解压失败通过后续轮询的 `demo.error` 和 `progress.message` 返回。
- 正在下载或解压时，重新分析返回 **409**。移除个人条目可正常进行。
- 服务重启后，访问录像列表或详情会恢复未完成的下载、解压任务，从头重新下载。

### 轮询解析

- 列表：`GET /api/demos` 按导入时间倒序返回当前账号的录像，`?limit=2` 仅取最近两次。每条带 `progress` 和 `victimPerspective`。
- 详情：`GET /api/demos/:id`，建议 **1.5–2 秒** 轮询，直到 `demo.status` 为 `ready` 或 `error`；`downloading`、`extracting`、`analyzing` 均需继续轮询。
- 建议：上传阶段用 XHR 百分比；201 之后改展示 `demo.progress.message`（以及若有的 `percent`）。

---

## 2. 录像详情与受害者视角

### `GET /api/demos/:id`

```json
{
  "demo": {
    "id": "b18620eb-1016-41a9-8e72-9d0bc3e8587c",
    "originalName": "match.dem",
    "status": "ready",
    "error": null,
    "mapName": "de_cache",
    "highlightCount": 44,
    "progress": {
      "phase": "ready",
      "percent": 100,
      "message": "解析完成，可以勾选片段。"
    },
    "victimPerspective": {
      "available": false,
      "message": "这段录像需要重新分析，才能回放受害者视角。"
    }
  },
  "match": {
    "mapName": "de_cache",
    "teamA": { "name": "Team A", "score": 13, "letter": "A" },
    "teamB": { "name": "Team B", "score": 11, "letter": "B" },
    "players": []
  },
  "frequentPlayers": [{ "steamId": "76561198000000001", "appearances": 4 }],
  "binding": { "state": "pending", "steamId": null },
  "highlights": [
    {
      "id": "ace:7656…:12:104422",
      "kind": "ace",
      "playerName": "选手",
      "kills": [
        { "tick": 104500, "weaponName": "AK-47", "victimName": "对手", "isHeadshot": true }
      ],
      "victimPerspectiveAvailable": false,
      "victimPerspectiveMessage": "这段录像需要重新分析，才能回放受害者视角。"
    }
  ],
  "reanalysis": {
    "inProgress": false,
    "highlightsPreserved": true,
    "highlightIdsChanged": false,
    "droppedHighlightIds": [],
    "message": null
  }
}
```

常用选手来自当前录像库。按录像的 `checksum` 去重，按 Steam ID 统计出场，换昵称和重分析都不增加次数。缺少校验值的录像不参与统计。只返回当前比赛名单中至少出场 3 次的选手，按次数、最近出场时间降序，最多 3 位。队伍的 `letter` 与选手的 `teamLetter` 对应。

### `PATCH /api/demos/:id/binding`

提交 `{ steamId, makePreferred? }`，返回 `{ binding: { state, steamId } }`。匹配本场名单的 ID 会写入 `selected`，传 `null` 写入 `skipped`。首次选择会记住账号的常用 Steam ID，后续只有 `makePreferred: true` 会更新常用身份。未决定身份的条目为 `pending`，读取详情时若匹配账号常用 ID，自动绑定。已绑定或已跳过的条目保留原决定。

视角开关：

- 当 **`demo.victimPerspective.available`** 为真，且已选片段中有可回放的受害者视角时，可开启「追加受害者视角回放」。
- 不可用时展示 **`demo.victimPerspective.message`**（已是人话，不要再拼内部原因）。
- 单条片段用 **`highlight.victimPerspectiveAvailable`**；若为 false，可禁用该片段的受害者视角，文案用 `victimPerspectiveMessage`。
- 忍者拆包等没有受害者的片段会返回「这个片段没有可跟随的受害者视角。」
- 旧解析缺少受害者信息时返回「这段录像需要重新分析，才能回放受害者视角。」需要用户确认后调用重新分析，服务端不会自动重跑。
- `kills` 里只有 `tick / weaponName / victimName / isHeadshot`，没有 Steam ID 字段。

重新分析期间，只要磁盘上已有上次结果，本接口仍会返回上次的 `highlights` 和 `match`，不会先清空。勾选仍以片段 `id` 为准（格式 `kind:steamId:round:anchorTick`，能稳定时会保持不变）。

---

## 3. 重新分析与删除

移除录像和重新分析前，页面会要求确认。

### `POST /api/demos/:id/analyze`

成功时返回 `{ demo, highlights, reanalysis, message }`。

- 不会清空服务端已保存的高光或勾选（勾选本来就在浏览器里）。
- 进行中：`reanalysis.inProgress === true`，`highlightsPreserved === true` 时文案为「正在重新分析。已勾选的片段编号会尽量保持不变。」
- 完成后若部分旧 id 不再存在：`highlightIdsChanged === true`，`droppedHighlightIds` 为失效 id，`message` 为「重新分析后，有些片段编号有变化，请再确认一次勾选。」
- 若 `.dem` 已经不在，返回 **409**，`error: "demo_file_missing"`，`message`：「这场录像的原始文件已经不在了，没法重新分析。请重新上传录像。」
- 重新分析失败且仍有上次列表时，状态会回到 `ready`，`demo.error` 会说明失败并声明仍使用上次列表。

### `DELETE /api/demos/:id`

移除当前账号的录像条目。返回 `{ ok: true }`。该账号以前提交的导出仍可查询、下载，其他账号的录像条目和共享录像文件仍可用。

---

## 4. 导出进度与耗时提示

### `GET /api/recorder`

```json
{
  "ready": true,
  "message": "录像机就绪。导出时会在这台电脑上打开 CS2，并用 csdm 把勾选的片段合成一条 MP4。",
  "exportWarning": "导出时会打开本机 CS2，录制过程中请不要操作游戏。等待时间通常比片段时长更长，因为还要启动游戏和编码。"
}
```

打开导出确认时请展示 `exportWarning`。不要把「片段时长之和」当成等待时间。

### `POST /api/exports`

请求体见文首。成功 **202**：

```json
{
  "warning": "导出时会打开本机 CS2，录制过程中请不要操作游戏。等待时间通常比片段时长更长，因为还要启动游戏和编码。",
  "job": {
    "id": "…",
    "demoId": "…",
    "mapName": "de_cache",
    "originalName": "match.dem",
    "highlightIds": ["…"],
    "status": "queued",
    "stage": "queued",
    "stageLabel": "排队等待中",
    "startedAt": null,
    "stageStartedAt": "2026-11-25T04:32:11.235Z",
    "observedStages": ["queued"],
    "estimatedRemaining": null,
    "clipDurationSeconds": 48,
    "estimatedWaitSeconds": 191,
    "estimatedWaitLabel": "大约需要 3 分钟，通常比片段时长更长",
    "warning": "导出时会打开本机 CS2，录制过程中请不要操作游戏。等待时间通常比片段时长更长，因为还要启动游戏和编码。",
    "error": null,
    "outputName": "拆片-de_cache.mp4",
    "options": { "showXRay": false, "perspective": "player" },
    "preset": { "width": 1280, "height": 720, "framerate": 30 }
  }
}
```

任务状态与进度：

- `status` 为 `queued | recording | done | failed`。准备、启动、录制和编码都归为 `recording`。
- 请优先展示 **`stage` + `stageLabel`**：
  - `queued` 排队等待中
  - `preparing` 正在准备录像
  - `starting_game` 正在启动 CS2
  - `recording` 正在录制片段
  - `encoding` 正在编码成片
  - `done` 导出完成
  - `error` 导出失败
- `startedAt` 记录开始准备录像的时间。用它显示执行耗时，排队时用 `createdAt` 显示已等待时长。`stageStartedAt` 为当前阶段的实际观测时间，`observedStages` 保存观测到的阶段。旧任务可能缺少时间和阶段记录。
- 进行中的 `estimatedRemaining` 为 `{ minSeconds, maxSeconds, source }`，`source` 为 `rough | history`。最近 20 条阶段时间完整的成功任务中至少有 3 条可用时，以各阶段耗时的 25% 到 75% 分位估算。录制与编码按片段时长归一。样本不足时沿用粗估公式。排队和终态返回 `null`。进行中上界为 0 时表示已超出预计时长。
- `estimatedWaitSeconds` / `estimatedWaitLabel` 是旧版粗略总耗时字段，包含启动和编码时间。工作台以 `estimatedRemaining` 为准。
- `clipDurationSeconds` 包含原片段和实际追加的受害者回放，是耗时估算使用的成片时长。
- 阶段来自队列、`csdm video --verbose` 输出及与本次任务输出目录匹配的 CSDM 本机日志。未观测到的阶段不会补写。服务重启后遗留的排队或执行任务以 `failed / error` 返回，用户可以重新提交。
- 准备录像时，拆片将已识别的 5E 来源传给 CSDM，并读取 `csdm analyze --json` 的结果。分析失败会直接进入 `error`，避免缺少选手记录时仍开始录制。

### 轮询导出

- `GET /api/exports/:id` → `{ job }`，建议 **2 秒** 一次，直到 `stage` 为 `done` 或 `error`（或 `status` 为 `done` / `failed`）。
- `GET /api/exports` 列出当前账号的全部任务，最新提交在前。`?demoId=` 限定个人录像条目。任务保存提交时的 `originalName` 和 `mapName`，移除录像后仍可在历史查看和下载。
- 完成后下载：`GET /api/exports/:id/file`（或 `fileHref(id)`），`status` 仍须为 `done`。

---

## 5. 启动方式

- 开发：`npm run dev`（已关闭 Next.js 左下角「N」指示器）。
- 产品：先 `npm run build`，再 `npm start`。首次启动前按部署说明创建管理员。

TEMP / 日志在 `E:\chaipian-tmp`，不要写进仓库目录里的日志文件。
