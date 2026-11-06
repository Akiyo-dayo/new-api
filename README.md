# nai-adapter

把 NovelAI 的图像 API 包装成 OpenAI 的图像 API，让 [new-api](https://github.com/Calcium-Ion/new-api) 把它当成一个普通 OpenAI 渠道使用。

- 暴露 `POST /v1/images/generations`、`POST /v1/images/edits`、`GET /v1/models`（供 new-api 拉取模型列表）、`GET /healthz`。
- 所有 NovelAI 协议细节（请求体、字段校验、Anlas 计费、参数版本差异）都交给 SDK `novelai-python==0.9.0`，本服务不拼任何 NovelAI HTTP 请求。
- 支持：文生图、图生图、局部重绘（infill）、Vibe Transfer（V4.5）、角色参考 / Precise Reference（V4.5、仅文生图）、多角色提示词、自定义 steps / CFG / sampler / seed。
- 支持模型：`nai-diffusion-4-5-full`、`nai-diffusion-4-5-curated`、`nai-diffusion-5-full`、`nai-diffusion-5-full-medium`、`nai-diffusion-5-curated`，以及它们各自的 `-inpainting` 变体。

---

## 一、使用说明（给调用方）

### 1. 鉴权

```
Authorization: Bearer pst-xxxxxxxx
```

这里的 token **就是 NovelAI 的 Persistent API Token**（`pst-` 开头）。它同时充当 new-api 的渠道 key，适配器只把它透传给 SDK，不落盘、不写日志。

缺少或格式不对（不是 `Bearer ...`）时返回 401。

### 2. 请求格式

两种 `Content-Type` 都支持：

- `application/json`：`image` / `mask` 用 base64 或 `data:image/png;base64,...`。
- `multipart/form-data`：`image` / `mask` 直接传文件，其余字段是表单文本；`parameters` 需要是 JSON 字符串。

```jsonc
{
  "model": "nai-diffusion-4-5-full",
  "prompt": "1girl, blue eyes, city at night",
  "n": 2,
  "size": "832x1216",
  "response_format": "b64_json",
  "parameters": {
    "steps": 28,
    "scale": 5.5,
    "sampler": "k_euler_ancestral",
    "seed": 123456789,
    "uc": "lowres, bad anatomy"
  }
}
```

顶层字段：

| 字段 | 说明 |
| --- | --- |
| `model` | 必填。白名单见上；`@` 之后的部分会被丢掉（例如 `nai-diffusion-5-full@v1`）。 |
| `prompt` | 必填，不能是空白字符串。 |
| `n` | 1..`MAX_N`（默认 4）。每张图单独调用一次 NovelAI（`n_samples` 恒为 1，Opus 只对单张免费），种子从 `seed` 起逐张加 1；中途失败时返回已生成的图，new-api 按实际返回张数计费。 |
| `size` | `宽x高`，两边都必须是 64 的倍数且在 64..2048 之间。省略时：文生图用 832x1216；图生图/重绘按原图比例缩放到不超过 1048576 像素再对齐到 64。 |
| `response_format` | 只接受 `b64_json`（默认）。`url` 会 400，因为 NovelAI 不返回可访问的 URL。 |
| `stream` | 只接受 `false`（默认）。`true` 会 400。 |
| `image` / `images` | base64、data URL，或只含一个元素的数组。`http(s)://` URL 会 400。给 `images` 多个元素也会 400。 |
| `mask` | 同上。没有 `image` 却给 `mask` 会 400。 |
| `parameters` / `extra_fields` | NovelAI 参数，两个都合并，`parameters` 优先。 |
| 其它顶层字段 | 一律忽略（`quality`、`style`、`user` 等 OpenAI 字段不会报错）。 |

### 3. 动作选择

| 请求 | 动作 |
| --- | --- |
| 没有 `image` | 文生图 |
| 有 `image`、没有 `mask` | 图生图（img2img） |
| 有 `image` 和 `mask` | 局部重绘（infill） |
| 只有 `mask` | 400 |
| 用了 `-inpainting` 模型但没有 `mask` | 400 |

### 4. 可用的 `parameters`

键名沿用 NovelAI 的写法，另外接受三个别名：`uc` → `negative_prompt`、`uc_preset` → `ucPreset`、`quality_toggle` → `qualityToggle`。

| 键 | 范围 / 说明 | 适用动作 |
| --- | --- | --- |
| `steps` | 1..min(50, `MAX_STEPS`) | 全部 |
| `scale` | 0..10，一位小数 | 全部 |
| `cfg_rescale` | 0..1，两位小数 | 全部 |
| `sampler` | SDK `Sampler` 的取值，如 `k_euler_ancestral` | 全部 |
| `noise_schedule` | `native` / `karras` / `exponential` / `polyexponential`，需与 sampler 兼容 | 全部 |
| `seed` | 0..4294967288，0 表示随机 | 全部 |
| `negative_prompt` / `uc` | 字符串 | 全部 |
| `ucPreset` / `uc_preset` | 0..3 | 全部 |
| `qualityToggle` / `quality_toggle` | 布尔 | 全部 |
| `variety_boost` | 布尔 | 全部 |
| `decrisp_mode` | 布尔 | 全部 |
| `characters` | 数组，元素 `{prompt, uc, center}`；`center` 可以是 `{x, y}`（0..0.9）或位置名（`A1`..`E5`）。数量上限由 SDK 的 `get_max_characters` 决定（V4.5 为 6，V5 为 32） | 全部 |
| `strength` | 0.01..0.99，两位小数 | 仅图生图 / 重绘 |
| `noise` | 0..0.99 | 仅图生图 |
| `extra_noise_seed` | 0..4294967288 | 仅图生图 |
| `add_original_image` | 布尔 | 仅重绘 |
| `vibe_transfer` | 数组，元素 `{image, strength, information_extracted}`；仅 V4.5（SDK `get_supported_params(model).encodedVibes`），最多 `MAX_VIBES` 个 | 全部 |
| `character_reference` | 对象或数组，元素 `{image, description, strength, fidelity, information_extracted}`；仅 V4.5，最多 `MAX_CHAR_REFS` 个 | 仅文生图 |
| `transparent_background` | 布尔，仅 V5 | 仅文生图 |

出现不在上表中的键（包括 `n_samples`、`width`、`height`、`image`、`mask`、`model`、`action`、`input`、`reference_image_multiple` 等）会直接 400，并在错误信息里列出全部可用键：这类参数由适配器根据顶层字段推导，绕过它会让计费和校验失效。

### 5. mask 约定

适配器同时接受两种习惯：

- **有 alpha 通道且确实存在半透明/透明像素** → 按 OpenAI 约定：alpha < 128 的区域重绘。
- 否则按 NovelAI 约定：灰度 ≥ 128 的区域重绘。

掩码会被缩放到与输出完全一致的尺寸（NEAREST），并转成 RGB PNG（白 = 重绘，黑 = 保留）。如果一个重绘像素都没有，返回 400。

### 6. 响应

成功（200）：

```json
{
  "created": 1730000000,
  "data": [{ "b64_json": "iVBORw0KGgo..." }]
}
```

同时带一个 `X-NAI-Anlas-Estimate` 响应头，值是本次请求的预估 Anlas 花费（含尚未命中缓存的 Vibe 编码）。

失败统一是 OpenAI 错误格式：

```json
{ "error": { "message": "...", "type": "invalid_request_error", "code": "invalid_request" } }
```

| 状态码 | 场景 |
| --- | --- |
| 400 | 参数/图片/掩码不合法；模型与动作不匹配；预估 Anlas 超过上限（`code: anlas_limit`）；无法估算花费 |
| 401 | 缺少 token；NovelAI 拒绝 token |
| 402 | NovelAI 返回余额不足（原样透传） |
| 413 | 单张图片超过 `MAX_IMAGE_BYTES`，或请求体超过 40MB |
| 429 | NovelAI 并发限制（`concurrent_generation`）；本服务的排队已满（`queue_full`）或排队超时（`queue_timeout`） |
| 502 | NovelAI 5xx、响应无法解析、连不上 NovelAI |
| 504 | 超过 `NAI_TIMEOUT_SECONDS` |
| 500 | 其它内部错误（详情只进日志，不回给客户端） |

### 7. curl 示例

```bash
# 文生图
curl -s http://nai-adapter:8000/v1/images/generations \
  -H "Authorization: Bearer $NAI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"nai-diffusion-4-5-full","prompt":"1girl, blue eyes","size":"832x1216","parameters":{"steps":28}}'

# 图生图
curl -s http://nai-adapter:8000/v1/images/edits \
  -H "Authorization: Bearer $NAI_TOKEN" \
  -F model=nai-diffusion-4-5-full \
  -F prompt="1girl, watercolor" \
  -F image=@source.png \
  -F 'parameters={"steps":28,"strength":0.6}'

# 局部重绘
curl -s http://nai-adapter:8000/v1/images/edits \
  -H "Authorization: Bearer $NAI_TOKEN" \
  -F model=nai-diffusion-4-5-full-inpainting \
  -F prompt="1girl" \
  -F image=@source.png \
  -F mask=@mask.png
```

---

## 二、部署与运维

### 0. 从备份还原（全新服务器或误删后）

本目录备份在 `Akiyo-dayo/new-api` 仓库的 `nai-adapter` 分支（独立分支，和 `chisa` 没有共同历史）。

```bash
git clone -b nai-adapter --single-branch https://github.com/Akiyo-dayo/new-api.git /opt/nai-adapter
mkdir -p /opt/nai-adapter/data/vibe-cache && chown -R 10001:10001 /opt/nai-adapter/data
docker network ls | grep new-api          # 网络名不是 new-api_new-api-network 时，改 docker-compose.yml
cd /opt/nai-adapter && docker compose up -d --build
docker exec new-api wget -q -O - http://nai-adapter:8000/healthz   # 应返回 {"ok":true}
```

然后按下面第 2 节在 new-api 里建渠道（或启用原来的渠道），记得打开「透传请求体」。`data/accounts.json` 里有密钥，不在备份里，要按 2.1 节重新写一份（不写也能跑，只是所有号都从本机直连）。可选：跑一遍离线测试

```bash
docker run --rm --network none -v /opt/nai-adapter:/src -w /src python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"
```

线上使用的限制（1 张 / 28 步 / 1024×1024 以内 / 每次最多 30 Anlas）写在 `docker-compose.yml` 的环境变量里，代码里的默认值更宽松。

### 1. docker compose

```bash
cd adapter
docker compose up -d --build
```

- 容器名 / 服务名：`nai-adapter`，`restart: always`。
- 网络：外部网络 `new-api_new-api-network`（即 new-api 的默认网络），**不映射任何宿主端口**，只允许 new-api 通过容器网络访问。
- 卷：`./data:/data`，Vibe 缓存落在 `/data/vibe-cache`。
- 健康检查：用标准库 `urllib` 请求 `http://127.0.0.1:8000/healthz`（镜像里不装 curl）。
- 镜像以非 root 用户（uid 10001）运行。

`docker compose down` 不会删掉 `./data`；换机器时把它一起带走可以让 Vibe 缓存继续命中。

容器以 uid 10001 运行，而 bind mount 会盖掉镜像里的 `chown`。第一次启动前先建好目录并交给它，否则 Vibe 缓存写不进去（服务不会因此失败，只是每次都要重新编码 Vibe）：

```bash
mkdir -p data/vibe-cache && sudo chown -R 10001:10001 data
```

### 2. 在 new-api 里新建渠道

| 项 | 值 |
| --- | --- |
| 类型 | OpenAI |
| Base URL | `http://nai-adapter:8000` |
| 密钥 | 你的 NovelAI Persistent API Token（`pst-...`） |
| 模型 | 填上面白名单里的模型名（可加 `@任意后缀`，适配器会丢掉） |
| 透传请求体 | 打开（不开的话 JSON 请求里的 `parameters` 会被 new-api 丢掉） |

new-api 会把渠道 key 原样放进 `Authorization: Bearer`，适配器就用这个 key 对应的 NovelAI 账号出图。

**一个 NovelAI 账号 = 一个 new-api 渠道**：加号时复制这个渠道，只换密钥（和名字），Base URL、模型、分组、透传、优先级、权重都保持一致。这样 new-api 会把请求平均分到各个号上，每个渠道的用量和收入就是对应账号的。每个号的出口代理写在下一节的 `accounts.json` 里。

### 2.1 每号独立代理（accounts.json）

在 `data/accounts.json`（容器里是 `/data/accounts.json`，可用 `NAI_ACCOUNTS_FILE` 改路径）登记每个渠道的 key 和它的出口：

```json
{
  "accounts": [
    {"name": "ch198", "token": "pst-..."},
    {"name": "ch199", "token": "pst-...", "proxy": "socks5h://user:pass@1.2.3.4:1080", "accept_language": "en"},
    {"name": "ch200", "token": "pst-...", "proxy": "http://user:pass@5.6.7.8:8080", "accept_language": "ja"}
  ]
}
```

- `name`：日志和状态里显示的名字（字母、数字、`-`、`_`），建议用 `ch<渠道ID>`，对得上 new-api。
- `token`：和 new-api 里那个渠道的密钥一模一样。**不在文件里的 key 一律 401**，不会悄悄从本机直连出去；所以新建渠道后一定要把它登记进来再启用。
- `proxy`：这个号所有 NovelAI 请求（出图、Vibe 编码、状态查询）的出口，支持 `http`、`https`、`socks4(a)`、`socks5`、`socks5h`（推荐，DNS 也走代理）。不写就从本机直连。代理不通时只会报错，**不会**退回直连。注意：SDK 不读 `HTTP(S)_PROXY` 环境变量，只能写在这里。
- `accept_language`：模拟浏览器的语言，跟代理所在国家对上（`en`、`ja`、`en-sg`、`zh`、`ko`……或完整的 Accept-Language 值），不写为英文。
- 文件里有 token 和代理密码：`chown 10001:10001 data/accounts.json && chmod 600 data/accounts.json`。
- 只在启动时读取，改完 `docker restart nai-adapter`（几秒，正在出图的请求会断）。文件格式或代理地址有错时服务**起不来**（`docker logs nai-adapter` 能看到哪一项错了，不会打印密钥），不会带病运行。
- 没有这个文件 = 行为和以前一样（任何 key 都当作账号，直连）。

负载均衡与冷却：

1. 分流由 new-api 做：同优先级、同权重的渠道随机均分。每个号同一时刻只跑一个生成，忙时在适配器里排队（见第 5 节），排不下回 429，new-api 会换个渠道重试（`RetryTimes`，目前 3 次）。
2. NovelAI 拒绝某个号后，这个号先**冷却**：冷却期间它的请求由适配器直接拒绝（不再去问 NovelAI），new-api 收到后换渠道重试。
   - 402 额度不足：冷却 `COOLDOWN_QUOTA_SECONDS`（30 分钟），只针对这一类请求（V5/V4.5 × 免费/付费 分开算）。例如 V5 体力条和 Anlas 都用完的号，免费的 V4.5 照样能出。
   - 401/403 token 失效：整个号冷却 `COOLDOWN_AUTH_SECONDS`（30 分钟），回 401。
   - 429 账号正忙（比如有人同时在网页上用这个号）：整个号冷却 `COOLDOWN_BUSY_SECONDS`（60 秒），回 429。
   - 连不上（代理挂了等）：整个号冷却 `COOLDOWN_NETWORK_SECONDS`（2 分钟），回 502。
   - 400 参数错误、超时：不冷却（换号也一样，超时还可能已经出过图）。
3. 局限：new-api 重试时是在同优先级里重新随机抽，不会刻意避开刚失败的渠道。大部分号都在冷却时，少数请求可能连续抽中冷却中的号而失败；冷却中的拒绝是即时的，不消耗 NovelAI 请求。

查每个号的出口 IP 和额度（token 只发给 NovelAI；查 IP 用的是不带 token 的单独请求）：

```bash
docker exec nai-adapter python -m app.status
# {"account": "B", "egress": "socks5h://1.2.3.4:1080", "exit": {"ip": "...", "country": "US", ...},
#  "tier": "Opus", "anlas": 9874, "bar_percent": 63, "bar_negative": false,
#  "v5_free_images_left": 1089, "v5_free_images_per_day": 190, ...}
```

渠道测试：测试时把端点类型选「图片生成」，new-api 会发一张 1024×1024 的测试图（Opus 下免费）；不选的话它会测 `/v1/chat/completions`，本服务没有这个接口，必然失败。

### 3. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_N` | `4` | 单次请求最多几张图（SDK 上限 8，取两者较小值）。 |
| `MAX_STEPS` | `50` | `steps` 上限。 |
| `MAX_VIBES` | `4` | 单次请求最多几个 Vibe。 |
| `MAX_CHAR_REFS` | `1` | 单次请求最多几个角色参考图。 |
| `MAX_IMAGE_BYTES` | `10485760` | 单张图片（含 mask / vibe / 角色参考）的字节上限，超过 413。 |
| `MAX_PIXELS` | `1048576` | 宽×高的像素上限（1024×1024），超过 400。 |
| `MAX_ANLAS_PER_IMAGE` | `0` | 每张图的预估 Anlas 上限（请求 n 张时总上限为 n 倍），`0` 表示只放行免费图，负数表示不限制。超过返回 400 `anlas_limit`，且不会发出任何 NovelAI 请求。旧名 `MAX_ANLAS_PER_REQUEST` 仍可用。 |
| `NAI_OPUS` | `true` | 计费时是否按 Opus 订阅计算。账号不是 Opus 时务必改成 `false`，否则预估会偏低。 |
| `VIBE_ENCODE_ANLAS` | `2` | 每次 Vibe 编码（缓存未命中）额外计入的 Anlas。 |
| `VIBE_CACHE_DIR` | `/data/vibe-cache` | Vibe 缓存目录。 |
| `VIBE_CACHE_MAX` | `500` | 缓存文件数上限，超出后按最近使用时间淘汰；设为 `0` 表示关闭缓存（不写盘，每次都重新编码）。 |
| `MAX_QUEUE` | `8` | 同一 token 上允许**同时等待**的请求数（不含正在执行的那个），超过立即 429。 |
| `QUEUE_TIMEOUT_SECONDS` | `120` | 已进入队列后的等待上限，超过 429。 |
| `MAX_WAIT_SECONDS` | `60` | 按最近的平均出图耗时估算前面要等多久，超过就立即 429 并带 `Retry-After`，不让请求干等到客户端超时。排队中的调用方断开时，会在 1 秒内被移出队列，不会出图。 |
| `NAI_TIMEOUT_SECONDS` | `120` | 单次 NovelAI 调用超时，超时 504。 |
| `LOG_LEVEL` | `INFO` | 日志级别。 |
| `NAI_ACCOUNTS_FILE` | `/data/accounts.json` | 账号与代理登记文件，不存在则任何 key 都直连（见 2.1）。 |
| `COOLDOWN_QUOTA_SECONDS` | `1800` | 号额度不足（402）后，同类请求跳过它多久。 |
| `COOLDOWN_AUTH_SECONDS` | `1800` | token 失效（401/403）后整个号跳过多久。 |
| `COOLDOWN_BUSY_SECONDS` | `60` | NovelAI 说号正忙（429）后跳过多久。 |
| `COOLDOWN_NETWORK_SECONDS` | `120` | 连不上 NovelAI（代理故障等）后跳过多久。 |

### 4. 为什么必须单进程 / 单 worker

NovelAI 一个账号同一时刻只能跑一个生成任务，所以适配器按 token 做串行化：**锁表是进程内的 `asyncio.Lock`**。如果起多个 worker 或多个副本，同一个 token 的请求会落到不同进程，锁就失效了，NovelAI 那边会直接回 429（`ConcurrentGenerationError`）。

因此 `Dockerfile` 里固定 `--workers 1`，`docker-compose.yml` 里也不要加 `scale` / `deploy.replicas`。要横向扩容，需要先把锁换成 Redis 之类的共享实现。

### 5. 排队行为

1. 请求先做完整校验和 Anlas 预估（不排队、不调 NovelAI）。
2. 取该 token 的锁；token 空闲时直接执行，token 忙时若已有 `MAX_QUEUE` 个请求在等，立即 429 `queue_full`。
3. 等锁超过 `QUEUE_TIMEOUT_SECONDS` → 429 `queue_timeout`。
4. 拿到锁后依次执行 Vibe 编码（未命中缓存时）和生成，全程受 `NAI_TIMEOUT_SECONDS` 约束，结束后一定释放锁。

`MAX_QUEUE=0` 表示"不排队"：token 忙时后续请求立即 429，token 空闲时照常执行。

### 6. 日志

每个请求一行 JSON，写到 stdout：

```json
{"request_id":"...","route":"generations","model":"nai-diffusion-4-5-full","action":"generate",
 "size":"832x1216","steps":28,"n":1,"vibes":0,"char_refs":0,"anlas":15,"account":"ch198",
 "queue_ms":0,"nai_ms":4210,"status":200,"elapsed_ms":4260}
```

`account` 是出图用的号（`accounts.json` 里的 name）。某个号进入冷却时会单独打一行 `{"event":"cooldown","account":...,"reason":"quota|auth|busy|network","seconds":...}`。启动时打一行 `{"event":"startup","accounts":[{"name":"A","egress":"direct"},...]}`。

**不会**记录 token、prompt 或任何图片数据。适配器自己的异常会带堆栈打进日志，但返回给客户端的只有 `internal error`。

### 7. Anlas 计费说明

- 预估来自 SDK 的 `GenerateImageInfer.calculate_cost(is_opus=NAI_OPUS)`，它按 NovelAI 网页端的规则算：尺寸、步数、模型、strength、n_samples、角色参考都会计入。
- 每个**未命中缓存**的 Vibe 额外加 `VIBE_ENCODE_ANLAS`（SDK 的 `calculate_cost` 明确不把 Vibe 编码算进生成价格）。
- `MAX_ANLAS_PER_IMAGE` 是硬上限，超过就 400，且此时还一次 NovelAI 请求都没发。
- 多张图要按张收费：new-api 里该模型的计费表达式写成 `tier("base", fixed(单价)) * image_count`，预扣按请求的 n，结算按实际返回张数。
- 预估失败的请求一律拒绝（400 `anlas_limit`），不做"盲发"。
- 预估值只是参考：实际扣费以 NovelAI 为准。

### 8. 本地开发与测试

```bash
cd adapter
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q                 # 全部离线，不需要 token，也不会联网
uvicorn app.main:app --reload
```

测试里 `GenerateImageInfer.request` 和 `EncodeVibe.request` 都被替换成记录器，断言的是适配器实际构建出来的 SDK 对象。

### 9. 真实环境联调

```bash
NAI_TOKEN=pst-... python scripts/live_test.py --base http://localhost:8000
```

会跑 8 个用例（V4.5/V5 文生图、V4.5/V5 图生图、V4.5/V5 重绘、V4.5 Vibe、V4.5 角色参考），每例 `n=1`、`steps=28`、`832x1216`，图片写到 `./live-out`。这会**真实消耗 Anlas**，所以默认会先问你一次；加 `--yes` 跳过确认，加 `--only <name>` 只跑单个用例。

值完班想省钱可以先用 `--only v45-t2i` 确认链路通。

---

## 三、目录结构

```
adapter/
├── app/
│   ├── __init__.py
│   ├── main.py      # FastAPI 路由、请求流水线、错误处理、请求日志
│   ├── config.py    # 环境变量
│   ├── parse.py     # OpenAI 请求 → ImageJob（纯校验，不联网）
│   ├── images.py    # 解码 / 缩放 / mask 转换（只用 Pillow）
│   ├── build.py     # ImageJob → SDK 对象；Vibe 编码与磁盘缓存
│   ├── queue.py     # 按 token 的进程内串行队列
│   ├── accounts.py  # accounts.json：key → 账号与代理，冷却
│   ├── status.py    # python -m app.status：各号出口 IP 与额度
│   └── errors.py    # OpenAI 错误格式 + SDK 异常映射
├── tests/           # pytest，全离线
├── scripts/live_test.py
├── requirements.txt
├── requirements-dev.txt
├── pytest.ini
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 四、已知限制

- 只支持 `b64_json`，不支持 `url` 和 `stream`。
- 一次请求只能带一张输入图（OpenAI 的 `images` 数组多元素会 400）。
- 角色参考（Precise Reference）只支持文生图，这是 NovelAI 网页端的行为。
- V5 不支持 Vibe Transfer，V4.5 不支持 `transparent_background`，都由 SDK 的能力表拒绝。
- 单进程限制见上文第 4 节。
