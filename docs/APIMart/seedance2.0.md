> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# doubao-seedance-2.0 视频生成

>  - 异步处理模式，返回任务ID用于后续查询
- 支持文生视频、图生视频（首帧/尾帧）
- 支持参考视频、参考音频、有声视频
- 支持横屏、竖屏、方形、超宽屏、自适应多种比例 

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.apimart.ai/v1/videos/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "doubao-seedance-2.0",
      "prompt": "小猫对着镜头打哈欠",
      "resolution": "720p",
      "size": "16:9",
      "duration": 5,
      "generate_audio": true
    }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1/videos/generations"

  payload = {
      "model": "doubao-seedance-2.0",
      "prompt": "小猫对着镜头打哈欠",
      "resolution": "720p",
      "size": "16:9",
      "duration": 5,
      "generate_audio": True
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
    model: "doubao-seedance-2.0",
    prompt: "小猫对着镜头打哈欠",
    resolution: "720p",
    size: "16:9",
    duration: 5,
    generate_audio: true
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

  ```go Go theme={null}
  package main

  import (
      "bytes"
      "encoding/json"
      "fmt"
      "io/ioutil"
      "net/http"
  )

  func main() {
      url := "https://api.apimart.ai/v1/videos/generations"

      payload := map[string]interface{}{
          "model":          "doubao-seedance-2.0",
          "prompt":         "小猫对着镜头打哈欠",
          "resolution":     "720p",
          "size":           "16:9",
          "duration":       5,
          "generate_audio": true,
      }

      jsonData, _ := json.Marshal(payload)

      req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
      req.Header.Set("Authorization", "Bearer <token>")
      req.Header.Set("Content-Type", "application/json")

      client := &http.Client{}
      resp, err := client.Do(req)
      if err != nil {
          panic(err)
      }
      defer resp.Body.Close()

      body, _ := ioutil.ReadAll(resp.Body)
      fmt.Println(string(body))
  }
  ```

  ```java Java theme={null}
  import java.net.http.HttpClient;
  import java.net.http.HttpRequest;
  import java.net.http.HttpResponse;
  import java.net.URI;

  public class Main {
      public static void main(String[] args) throws Exception {
          String url = "https://api.apimart.ai/v1/videos/generations";

          String payload = """
          {
            "model": "doubao-seedance-2.0",
            "prompt": "小猫对着镜头打哈欠",
            "resolution": "720p",
            "size": "16:9",
            "duration": 5,
            "generate_audio": true
          }
          """;

          HttpClient client = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create(url))
              .header("Authorization", "Bearer <token>")
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(payload))
              .build();

          HttpResponse<String> response = client.send(request,
              HttpResponse.BodyHandlers.ofString());

          System.out.println(response.body());
      }
  }
  ```

  ```php PHP theme={null}
  <?php

  $url = "https://api.apimart.ai/v1/videos/generations";

  $payload = [
      "model" => "doubao-seedance-2.0",
      "prompt" => "小猫对着镜头打哈欠",
      "resolution" => "720p",
      "size" => "16:9",
      "duration" => 5,
      "generate_audio" => true
  ];

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer <token>",
      "Content-Type: application/json"
  ]);

  $response = curl_exec($ch);
  curl_close($ch);

  echo $response;
  ?>
  ```

  ```ruby Ruby theme={null}
  require 'net/http'
  require 'json'
  require 'uri'

  url = URI("https://api.apimart.ai/v1/videos/generations")

  payload = {
    model: "doubao-seedance-2.0",
    prompt: "小猫对着镜头打哈欠",
    resolution: "720p",
    size: "16:9",
    duration: 5,
    generate_audio: true
  }

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  request = Net::HTTP::Post.new(url)
  request["Authorization"] = "Bearer <token>"
  request["Content-Type"] = "application/json"
  request.body = payload.to_json

  response = http.request(request)
  puts response.body
  ```

  ```swift Swift theme={null}
  import Foundation

  let url = URL(string: "https://api.apimart.ai/v1/videos/generations")!

  let payload: [String: Any] = [
      "model": "doubao-seedance-2.0",
      "prompt": "小猫对着镜头打哈欠",
      "resolution": "720p",
      "size": "16:9",
      "duration": 5,
      "generate_audio": true
  ]

  var request = URLRequest(url: url)
  request.httpMethod = "POST"
  request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

  let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
          print("Error: \(error)")
          return
      }

      if let data = data, let responseString = String(data: data, encoding: .utf8) {
          print(responseString)
      }
  }

  task.resume()
  ```

  ```csharp C# theme={null}
  using System;
  using System.Net.Http;
  using System.Text;
  using System.Threading.Tasks;

  class Program
  {
      static async Task Main(string[] args)
      {
          var url = "https://api.apimart.ai/v1/videos/generations";

          var payload = @"{
              ""model"": ""doubao-seedance-2.0"",
              ""prompt"": ""小猫对着镜头打哈欠"",
              ""resolution"": ""720p"",
              ""size"": ""16:9"",
              ""duration"": 5,
              ""generate_audio"": true
          }";

          using var client = new HttpClient();
          client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

          var content = new StringContent(payload, Encoding.UTF8, "application/json");
          var response = await client.PostAsync(url, content);
          var result = await response.Content.ReadAsStringAsync();

          Console.WriteLine(result);
      }
  }
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": [
      {
        "status": "submitted",
        "task_id": "task_01KMCGF6BQGN3X28H3KSR50X5T"
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

<ParamField body="model" type="string" required>
  视频生成模型名称

  支持的模型：

  * `doubao-seedance-2.0` - 标准版，支持文生视频、图生视频、首尾帧视频、参考视频、参考音频、有声视频
  * `doubao-seedance-2.0-fast` - 快速版，功能与标准版一致，生成速度更快
  * `doubao-seedance-2.0-mini` - 迷你版，功能与标准版一致
</ParamField>

<ParamField body="prompt" type="string">
  视频内容描述

  文生视频时必填，图生视频/视频参考生视频时可选

  建议明确主体、动作、镜头和风格，以获得更好的生成效果

  <Warning>
    * 提示词限制输入 4000 个字符，但是建议输入 500 字符。
    * 模型 `doubao-seedance-2.0-mini` 没有字数限制。建议：中文提示词不超过500字,英文提示词不超过1000词。字数过多易导致信息分散,模型可能忽略细节、
      仅关注重点,进而造成视频缺失部分元素。
  </Warning>

  示例：`"小猫对着镜头打哈欠"`
</ParamField>

<ParamField body="duration" type="integer" default="5">
  视频时长（秒）

  支持范围：`4` \~ `15` 秒

  默认值：`5`
</ParamField>

<ParamField body="size" type="string" default="16:9">
  视频宽高比

  可选值：

  * `16:9` - 横屏
  * `9:16` - 竖屏
  * `1:1` - 方形
  * `4:3` - 传统比例
  * `3:4` - 竖向传统比例
  * `21:9` - 超宽屏
  * `adaptive` - 自适应（根据输入图片/视频自动匹配）

  默认值：`16:9`
</ParamField>

<ParamField body="resolution" type="string" default="720p">
  视频分辨率

  可选值：

  * `480p` - 标清
  * `720p` - 高清
  * `1080p` - 全高清（仅 `doubao-seedance-2.0` 支持）
  * `4k` - 超高清（仅 `doubao-seedance-2.0` 支持）

  默认值：`720p`
</ParamField>

<ParamField body="seed" type="integer">
  随机种子，用于控制生成内容的随机性

  <Note>
    * 相同的请求下，模型收到不同的 seed 值，将生成不同的结果
    * 相同的请求下，模型收到相同的 seed 值，会生成类似的结果，但不保证完全一致
  </Note>
</ParamField>

<ParamField body="generate_audio" type="boolean" default="true">
  是否生成音频（有声视频）

  设置为 `true` 时，视频将包含 AI 生成的配套音频

  设置为 `false` 时，视频将不包含音频（无声视频）

  默认值：`true`
</ParamField>

<ParamField body="return_last_frame" type="boolean" default="false">
  是否返回尾帧图片

  设置为 `true` 时，任务结果中会额外返回视频最后一帧的图片 URL，可用于连续视频生成

  默认值：`false`
</ParamField>

<ParamField body="tools" type="array<object>">
  工具列表，用于联网搜索等增强能力

  示例：`[{"type": "web_search"}]`

  <Expandable title="字段说明">
    <ParamField body="type" type="string" required>
      工具类型

      可选值：

      * `web_search` - 联网搜索，生成时参考网络信息
    </ParamField>
  </Expandable>
</ParamField>

<ParamField body="image_urls" type="array<string>">
  图片 URL 数组，用于图生视频

  支持两种格式：

  * 普通图片 URL：`https://example.com/cat.jpg`
  * Asset URL（审核通过的素材）：`asset://asset_a`

  示例：`["https://example.com/cat.jpg"]` 或 `["asset://asset_a"]`

  <Note>
    Asset URL 仅支持 `doubao-seedance-2.0` 和 `doubao-seedance-2.0-fast` 模型，其他模型不可使用
  </Note>

  <Warning>
    * `image_urls` 和 `image_with_roles` 不能同时使用
    * 最多 9 张参考图
  </Warning>
</ParamField>

<ParamField body="image_with_roles" type="array">
  带角色的图片数组，支持指定首帧/尾帧

  <Note>
    `url` 字段使用 Asset URL 时，仅支持 `doubao-seedance-2.0` 和 `doubao-seedance-2.0-fast` 模型，其他模型不可使用
  </Note>

  <Expandable title="字段说明">
    <ParamField body="url" type="string" required>
      图片 URL 地址

      支持两种格式：

      * 普通图片 URL：`https://example.com/day.jpg`
      * Asset URL（审核通过的素材）：`asset://asset_a`

      <Note>
        Asset URL 仅支持 `doubao-seedance-2.0` 和 `doubao-seedance-2.0-fast` 模型，其他模型不可使用
      </Note>
    </ParamField>

    <ParamField body="role" type="string" required>
      图片角色

      可选值：

      * `first_frame` - 首帧图，作为视频起始画面
      * `last_frame` - 尾帧图，作为视频结束画面
      * `reference_image` - 参考人像图（配合 Asset URL 使用）
    </ParamField>
  </Expandable>

  示例：

  ```json theme={null}
  [
    {"url": "https://example.com/day.jpg", "role": "first_frame"},
    {"url": "https://example.com/night.jpg", "role": "last_frame"}
  ]
  ```

  Asset URL 写法：

  ```json theme={null}
  [
    {"url": "asset://asset_a", "role": "reference_image"}
  ]
  ```

  <Warning>
    * `image_urls` 和 `image_with_roles` 不能同时使用
    * 使用首尾帧图片时，`video_urls` 和 `audio_urls` 不可用
  </Warning>
</ParamField>

<ParamField body="video_urls" type="array<string>">
  参考视频 URL 数组

  支持两种格式：

  * 普通视频 URL：`https://example.com/reference.mp4`
  * Asset URL（审核通过的素材）：`asset://asset_a`

  示例：`["https://example.com/reference.mp4"]` 或 `["asset://asset_a"]`

  <Note>
    Asset URL 仅支持 `doubao-seedance-2.0` 和 `doubao-seedance-2.0-fast` 模型，其他模型不可使用
  </Note>

  <Warning>
    * 使用首帧/尾帧图片（`image_with_roles`）时，参考视频不可用
    * 最多 3 个参考视频，1.8s \< 总时长 \< 15.2s
    * 参考视频分辨率需要在 480P \~ 720P 之间
    * 参考视频不可出现真人
  </Warning>
</ParamField>

<ParamField body="audio_urls" type="array<string>">
  参考音频 URL 数组

  支持两种格式：

  * 普通音频 URL：`https://example.com/speech.wav`
  * Asset URL（审核通过的素材）：`asset://asset_a`

  示例：`["https://example.com/speech.wav"]` 或 `["asset://asset_a"]`

  <Note>
    Asset URL 仅支持 `doubao-seedance-2.0` 和 `doubao-seedance-2.0-fast` 模型，其他模型不可使用
  </Note>

  <Warning>
    * 使用首帧/尾帧图片（`image_with_roles`）时，参考音频不可用
    * 最多 3 个参考音频，总时长 ≤ 15s
    * 参考音频需与参考图片或者参考视频使用
  </Warning>
</ParamField>

## 响应

<ResponseField name="code" type="integer">
  响应状态码，成功时为 200
</ResponseField>

<ResponseField name="data" type="array">
  返回数据数组

  <Expandable title="数组元素">
    <ResponseField name="status" type="string">
      任务状态，初始提交时为 `submitted`
    </ResponseField>

    <ResponseField name="task_id" type="string">
      任务唯一标识符，用于查询任务状态和结果
    </ResponseField>
  </Expandable>
</ResponseField>

## 使用场景

### 场景 1：文生视频

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "小猫对着镜头打哈欠",
  "resolution": "720p",
  "size": "16:9",
  "duration": 5,
  "seed": 42,
  "generate_audio": true
}
```

### 场景 2：图生视频（首帧）

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "小猫站起来走向镜头",
  "image_urls": ["https://example.com/cat.jpg"],
  "duration": 5
}
```

### 场景 3：首尾帧视频

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "从白天过渡到夜晚",
  "image_with_roles": [
    {"url": "https://example.com/day.jpg", "role": "first_frame"},
    {"url": "https://example.com/night.jpg", "role": "last_frame"}
  ],
  "duration": 5
}
```

### 场景 4：视频参考生视频

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "将视频风格转换为动漫风格",
  "video_urls": ["https://example.com/reference.mp4"]
}
```

### 场景 5：参考视频 + 参考音频

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "人物说话的场景",
  "video_urls": ["https://example.com/reference.mp4"],
  "audio_urls": ["https://example.com/speech.wav"],
  "size": "16:9",
  "duration": 11
}
```

### 场景 6：有声视频

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "男人叫住女人说：\"你记住，以后不可以用手指指月亮。\"",
  "generate_audio": true
}
```

### 场景 7：连续视频生成（返回尾帧）

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "小猫继续走向镜头",
  "image_urls": ["https://example.com/last_frame_from_prev.png"],
  "return_last_frame": true
}
```

### 场景 8：快速版生成

```json theme={null}
{
  "model": "doubao-seedance-2.0-fast",
  "prompt": "城市夜景延时摄影",
  "size": "21:9",
  "duration": 8
}
```

### 场景 9：参考图片 + 参考视频 + 参考音频（多模态视频）

结合参考图片、参考视频和参考音频，生成沉浸式第一人称视角广告视频。适用于产品宣传、品牌广告等需要多素材融合的场景。

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；2-4秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；4-6秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；6-8秒：第一人称手持举杯，你将图片2中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。背景声音统一为女生音色。",
  "image_urls": [
    "https://example.com/tea_pic1.jpg",
    "https://example.com/tea_pic2.jpg"
  ],
  "video_urls": ["https://example.com/tea_video1.mp4"],
  "audio_urls": ["https://example.com/tea_audio1.mp3"],
  "generate_audio": true,
  "size": "16:9",
  "duration": 11
}
```

### 场景 10：使用 Asset URL 图生视频

审核通过的虚拟人像素材可直接作为参考图片传入，无需重新上传和审核。

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "人物在城市街道自然行走，阳光明媚",
  "image_urls": ["asset://asset_a"],
  "duration": 5,
  "resolution": "720p"
}
```

### 场景 11：使用 Asset URL 指定参考人像（image\_with\_roles）

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "使用参考人像，人物优雅地走向镜头",
  "image_with_roles": [
    {
      "url": "asset://asset_a",
      "role": "reference_image"
    }
  ],
  "resolution": "720p",
  "duration": 5
}
```

### 场景 12：快速版 + Asset URL 图生视频

```json theme={null}
{
  "model": "doubao-seedance-2.0-fast",
  "prompt": "人物在公园里漫步，微风轻拂",
  "image_urls": ["asset://asset_a"],
  "duration": 5,
  "resolution": "720p"
}
```

### 场景 13：Asset URL 图片 + 参考视频（动作迁移）

将审核通过的人像素材与参考视频结合，驱动人物完成指定动作。

```json theme={null}
{
  "model": "doubao-seedance-2.0",
  "prompt": "人物按照参考视频的节奏起舞，动作连贯自然",
  "image_urls": ["https://example.com/dance_reference.jpg", "asset://asset_a"],
  "video_urls": ["https://example.com/dance_reference.mp4", "asset://asset_a"],
  "duration": 8,
  "resolution": "720p"
}
```

<Note>
  **查询任务结果**

  视频生成为异步任务，提交后会返回 `task_id`。使用 [获取任务状态](/cn/api-reference/tasks/status) 接口查询生成进度和结果。
</Note>

## 与 1.5 Pro 版本的差异

| 特性    | 1.5 Pro                           | 2.0 / 2.0 fast                           |
| ----- | --------------------------------- | ---------------------------------------- |
| 分辨率   | 480p/720p/1080p                   | **480p/720p/1080p/4k**（fast 仅 480p/720p） |
| 时长范围  | 4-12秒                             | **5-15秒**                                |
| 默认时长  | 5秒                                | **5秒**                                   |
| 宽高比参数 | `aspect_ratio`                    | **`size`**（新增 `adaptive` 自适应）            |
| 音频生成  | `audio` 参数                        | **`generate_audio` 参数**                  |
| 参考视频  | 不支持                               | **支持 `video_urls`**                      |
| 参考音频  | 不支持                               | **支持 `audio_urls`**                      |
| 图生视频  | `image_urls` / `image_with_roles` | **`image_urls` / `image_with_roles`**    |
| 有声视频  | 不支持                               | **支持 `generate_audio`**                  |
| 连续视频  | 不支持                               | **支持 `return_last_frame`**               |
| 快速版   | 不支持                               | **支持 `doubao-seedance-2.0-fast`**        |
