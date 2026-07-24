> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Grok Imagine 1.5 视频生成

>  - 异步处理模式，返回任务ID用于后续查询
- 高质量AI视频生成，支持文生视频、图生视频
- 灵活的比例与质量选择，满足不同创作需求 

<Info>
  **模型名兼容提示**：本接口同时兼容别名 `grok-imagine-1.5-video-ext`，它等价于 `grok-imagine-1.5-video-apimart`，两者可互换使用、效果一致。
</Info>

<RequestExample>
  ```bash cURL theme={null}
  # model 可填 "grok-imagine-1.5-video-apimart"，也兼容别名 "grok-imagine-1.5-video-ext"
  curl --request POST \
    --url https://api.apimart.ai/v1/videos/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "grok-imagine-1.5-video-apimart",
      "prompt": "一只狗在海滩上奔跑，阳光明媚，慢镜头",
      "size": "16:9",
      "duration": 6,
      "quality": "720p"
    }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1/videos/generations"

  payload = {
      "model": "grok-imagine-1.5-video-apimart",
      "prompt": "一只狗在海滩上奔跑，阳光明媚，慢镜头",
      "size": "16:9",
      "duration": 6,
      "quality": "720p"
  }

  headers = {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
  }

  response = requests.post(url, json=payload, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const url = "https://api.apimart.ai/v1/videos/generations";

  const payload = {
    model: "grok-imagine-1.5-video-apimart",
    prompt: "一只狗在海滩上奔跑，阳光明媚，慢镜头",
    size: "16:9",
    duration: 6,
    quality: "720p"
  };

  const headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  };

  fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": [
      {
        "task_id": "task_01JNXXXXXXXXXXXXXXXXXX",
        "status": "submitted"
      }
    ]
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "请求参数无效",
      "type": "invalid_request_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "身份验证失败，请检查您的API密钥",
      "type": "authentication_error"
    }
  }
  ```

  ```json 402 theme={null}
  {
    "error": {
      "code": 402,
      "message": "账户余额不足，请充值后再试",
      "type": "payment_required"
    }
  }
  ```

  ```json 403 theme={null}
  {
    "error": {
      "code": 403,
      "message": "访问被禁止，您没有权限访问此资源",
      "type": "permission_error"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "请求过于频繁，请稍后再试",
      "type": "rate_limit_error"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "服务器内部错误，请稍后重试",
      "type": "server_error"
    }
  }
  ```

  ```json 502 theme={null}
  {
    "error": {
      "code": 502,
      "message": "网关错误，服务器暂时不可用",
      "type": "bad_gateway"
    }
  }
  ```
</ResponseExample>

## 认证

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用 Bearer Token 进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://apimart.ai/keys) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## 请求参数

<ParamField body="model" type="string" default="grok-imagine-1.5-video-apimart" required>
  视频生成模型名称

  支持的模型：

  * `grok-imagine-1.5-video-apimart` - Grok 视频生成（兼容别名 `grok-imagine-1.5-video-ext`）

  示例：`"grok-imagine-1.5-video-apimart"`

  <Note>
    为兼容旧版调用，别名 `grok-imagine-1.5-video-ext`（对应 `grok-imagine-1.5-video-apimart`）仍可正常使用。
  </Note>
</ParamField>

<ParamField body="prompt" type="string" required>
  视频内容描述，支持中英文
</ParamField>

<ParamField body="size" type="string" default="16:9">
  视频尺寸

  可选值：

  * `16:9` - 横屏（默认）
  * `9:16` - 竖屏
  * `1:1` - 正方形
  * `3:2` - 横屏
  * `2:3` - 竖版
</ParamField>

<ParamField body="duration" type="integer" default={6}>
  视频时长（秒）

  取值范围：6-30（最短 6 秒，最长 30 秒）

  **⚠️ 注意：** 必须输入纯数字（如 `6`），不要加引号，否则会报错
</ParamField>

<ParamField body="quality" type="string" default="480p">
  视频质量

  可选值：

  * `480p` - 标清（默认）
  * `720p` - 高清
</ParamField>

<ParamField body="image_urls" type="string[]">
  参考图像的 URL 列表

  **限制：**

  * 最多 7 张图片
  * 必须是公网可访问的 URL
  * 不支持 base64 格式

  <Tip>上传参考图之后，宽高比会自动匹配参考图的宽高比</Tip>
</ParamField>

## 响应

<ResponseField name="code" type="integer">
  响应状态码
</ResponseField>

<ResponseField name="data" type="object[]">
  响应数据数组

  <Expandable title="属性">
    <ResponseField name="task_id" type="string">
      任务唯一标识符
    </ResponseField>

    <ResponseField name="status" type="string">
      任务状态

      * `submitted` - 已提交
    </ResponseField>
  </Expandable>
</ResponseField>

<Note>
  **查询任务结果**

  视频生成为异步任务，提交后会返回 `task_id`。使用 [获取任务状态](/cn/api-reference/tasks/status) 接口查询生成进度和结果。
</Note>

## 使用场景

### 场景 1：文生视频

```json theme={null}
{
  "model": "grok-imagine-1.5-video-apimart",
  "prompt": "一只狗在海滩上奔跑，阳光明媚，慢镜头",
  "size": "16:9",
  "duration": 6
}
```

### 场景 2：图生视频

```json theme={null}
{
  "model": "grok-imagine-1.5-video-apimart",
  "prompt": "让画面动起来，添加自然的动态效果",
  "image_urls": ["https://example.com/start.png"],
  "size": "16:9",
  "duration": 10,
  "quality": "720p"
}
```
