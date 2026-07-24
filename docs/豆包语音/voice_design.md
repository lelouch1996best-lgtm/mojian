
<span id="e65bb1d9"></span>
## 请求路径

* 服务使用的请求路径：`https://openspeech.bytedance.com/api/v3/tts/voice_design`

<span id="a5640d43"></span>
## 建连&鉴权

* HTTP 请求头（Request Header 中）添加以下信息

使用[新版控制台](https://console.volcengine.com/speech/new)时，推荐采用以下更简化的鉴权方式。

| | | | | | \
|**Key** |**说明** |**参数类型** |**是否必须** |**Value 示例** |
|---|---|---|---|---|
| | | | | | \
|Content-Type |固定值 |string |必须 |"application/json" |
| | | | | | \
|X-Api-Key |使用火山引擎控制台获取的API Key，可参考 [控制台API Key管理](https://www.volcengine.com/docs/6561/2119699?lang=zh#ew1HctnP) |string |必须 |"your-api-key" |
| | | | | | \
|X-Api-Request-Id |标识客户端请求ID，uuid随机字符串 |string |必须 |"67ee89ba-7050-4c04-a3d7-ac61a63499b3" |


```Python
headers = {
    "Content-Type": "application/json",
    "X-Api-Key": "your-api-key",
    "X-Api-Request-Id": "67ee89ba-7050-4c04-a3d7-ac61a63499b3",
}
```

若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权方式如下。建议尽快切换至新版，以体验更便捷的鉴权流程。

| | | | | | \
|**Key** |**说明** |**参数类型** |**是否必须** |**Value 示例** |
|---|---|---|---|---|
| | | | | | \
|Content-Type |固定值 |string |必须 |"application/json" |
| | | | | | \
|X-Api-App-Key |使用火山引擎控制台获取的APP ID，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F)（旧版控制台使用，新版控制台只需要X-Api-Key即可） |string |必须 |"123456789" |
| | | | | | \
|X-Api-Access-Key |使用火山引擎控制台获取的Access Token，可参考 [控制台使用FAQ-Q1](https://www.volcengine.com/docs/6561/196768#q1%EF%BC%9A%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%8F%96%E5%88%B0%E4%BB%A5%E4%B8%8B%E5%8F%82%E6%95%B0appid%EF%BC%8Ccluster%EF%BC%8Ctoken%EF%BC%8Cauthorization-type%EF%BC%8Csecret-key-%EF%BC%9F)（旧版控制台使用，新版控制台只需要X-Api-Key即可） |string |必须 |"your-access-key" |
| | | | | | \
|X-Api-Request-Id |标识客户端请求ID，uuid随机字符串 |string |必须 |"67ee89ba-7050-4c04-a3d7-ac61a63499b3" |

```Python
headers = {
    "Content-Type": "application/json",
    "X-Api-App-Key": "123456789",
    "X-Api-Access-Key": "your-access-key",
    "X-Api-Request-Id": "67ee89ba-7050-4c04-a3d7-ac61a63499b3",
}
```


* 在HTTP请求成功后，会返回这些 Response header


| | | | \
|Key |说明 |Value 示例 |
|---|---|---|
| | | | \
|X-Tt-Logid |服务端返回的 logid，建议用户获取和打印方便定位问题 |202407261553070FACFE6D19421815D605 |

<span id="fe82ad89"></span>
## **请求参数**

| | | | | | \
|参数名称 |层级 |类型 |是否必须 |备注 |
|---|---|---|---|---|
| | | | | | \
|speaker_id |1 |string |必须 |唯一音色代号，[控制台购买](https://www.volcengine.com/docs/6561/1167802?lang=zh) |
| | | | | | \
|text |1 |string |必须 |试听文本，限制 300 字 |
| | | | | | \
|prompt |1 |object |必须 |提示词，下层级的 text_prompt 和 image_prompt 不能同时为空。同时存在的时候 image_prompt 有更高优先级生效。 |
| | | | | | \
|prompt.text_prompt |2 |string |否 |文本提示词，类似“女性，语速中等偏快，语调低沉有力”，限制 200 字 |
| | | | | | \
|prompt.image_prompt |2 |object |否 |图片提示，下面image_url 和 image_bytes 二选一，大小限制：10M |
| | | | | | \
|prompt.image_prompt.image_url |3 |string |否 |图片提示，这里可以填写可下载的图片 url 地址  |
| | | | | | \
|prompt.image_prompt.image_bytes |3 |string |否 |图片提示，这里可以传图片的 base64 编码之后的结果 (同时存在优先级高) |
| | | | | | \
|language |1 |int |否 |以下为语种对应的枚举值 |\
| | | | | |\
| | | | |* cn = 0 中文（默认） |\
| | | | |* en = 1 英文 |

<span id="73af01ac"></span>
## **请求示例**
```JSON
{
  "prompt": {
    "text_prompt": "女性，语速中等偏快，语调低沉有力",
    "image_prompt": {
      "image_bytes": "base64编码后的图片字符串",
      "image_url": "http://test.com/VoiceDesignPrompt_1772094127562.png"
    }
  },
  "text": "夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。",
  "speaker_id": "S_*******",
}
```

<span id="aa9feaa4"></span>
## 返回参数

| | | | | | \
|参数名称 |层级 |参数类型 |是否必须 |备注 |
|---|---|---|---|---|
| | | | | | \
|code |1 |int |可选 |失败时候HTTP返回非200，该字段返回详细错误码 |
| | | | | | \
|message |1 |string |可选 |失败时候HTTP返回非200，该字段返回详细错误信息 |
| | | | | | \
|available_training_times |1 |int |可选 |剩余可设计次数 |
| | | | | | \
|create_time |1 |int |可选 |创建时间 |
| | | | | | \
|language |1 |\
| | |int |可选 |以下为语种对应的枚举值 |\
| | | | | |\
| | | | |* cn = 0 中文（默认） |\
| | | | |* en = 1 英文 |
| | | | | | \
|speaker_id |1 |string |可选 |唯一音色代号 |
| | | | | | \
|status |\
| |1 |int |可选 |\
| | | | |训练状态，状态为2或4时都可以调用tts |\
| | | | | |\
| | | | |* NotFound = 0 |\
| | | | |* Training = 1  |\
| | | | |* Success = 2  |\
| | | | |* Failed = 3 |\
| | | | |* Active = 4 |
| | | | | | \
|demo_audio |1 |string |可选 |Success状态时返回，一小时有效，若需要，请下载后使用 |

<span id="007f246f"></span>
## 返回示例
```JSON
{
  "available_training_times": 15,
  "create_time": 1772026663000,
  "language": 0,
  "speaker_id": "S_*******",
  "demo_audio": "https://lf6-lab-speech-tt-sign.bytespeech.com/tos-cn-o-14155/o0ftE0YFM8eECAX78jC3AHopgAijApN6uMBCAi?x-expires=1773912669&x-signature=g7ui2EQVJ0PShNKC%2BArg%2Bf7ZdoQ%3D",
  "status": 2
}
```

<span id="41a84ff0"></span>
## 错误码
您在调用API接口过程中，如果服务端返回结果报错，则表示操作失败。您可以通过返回结果中的错误码快速地定位问题，并根据对应的解决方案尝试修改代码或者反馈给终端用户加以解决。

| | | | | | \
|**参数名称** |**层级** |**参数类型** |**是否必须** |**备注** |
|---|---|---|---|---|
| | | | | | \
|code |1 |int |可选 |训练失败时候HTTP返回非200，该字段返回详细错误码 |
| | | | | | \
|message |1 |string |可选 |训练失败时候HTTP返回非200，该字段返回详细错误信息 |


| | | \
|**错误码分类** |**错误码表示** |
|---|---|
| | | \
|服务端报错 |8位错误码，以5开头，例如：50001201 |
| | | \
|客户操作错误导致的服务端报错 |8位错误码，以4开头，例如：40001101 |


| | | | | \
|错误码code |状态信息message |原因 |解决方案 |
|---|---|---|---|
| | | | | \
|45001001 |请求参数有误 |参数缺失/格式不对/不符合约束 |按接口校验规则修正参数；补齐必填字段；检查枚举值 |
| | | | | \
|45001123 |达到设计次数上限 |超过音色设计次数限制 |更换为还有设计次数的 speaker_id |
| | | | | \
|55001308 |音色设计失败 |下游失败/超时/返回异常 |服务异常、可能需要重试 |

<span id="c85d7220"></span>
## 调用示例
使用[新版控制台](https://console.volcengine.com/speech/new)时，推荐采用以下更简化的鉴权方式。ApiKey 的调用方式：
```JSON
curl -X POST "https://openspeech.bytedance.com/api/v3/tts/voice_design" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: api-key" \
  -H "X-Api-Request-Id: $(uuidgen)" \
  -d '{
    "prompt": {
      "text_prompt": "女性，语速中等偏快，语调低沉有力"
    },
    "text": "夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。",
    "speaker_id": "S_*********"
  }'
```

若使用[旧版控制台](https://console.volcengine.com/speech/app)，鉴权方式如下。建议尽快切换至新版，以体验更便捷的鉴权流程。Appid + AccessKey 的调用方式：
```JSON
curl -X POST "https://openspeech.bytedance.com/api/v3/tts/voice_design" \
  -H "Content-Type: application/json" \
  -H "X-Api-Access-Key: access-key" \
  -H "X-Api-App-Key: appid" \
  -H "X-Api-Request-Id: $(uuidgen)" \
  -d '{
    "prompt": {
      "text_prompt": "女性，语速中等偏快，语调低沉有力"
    },
    "text": "夜色渐浓，城市的灯火次第亮起，每个人都在为自己的生活奔波，从未停歇。",
    "speaker_id": "S_*********"
  }'
```

