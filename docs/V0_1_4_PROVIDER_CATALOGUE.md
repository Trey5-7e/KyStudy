# v0.1.4 国内 AI 供应商预设

Provider 配置页沿用 CC Switch 的“供应商卡片 → 自动填充 → 手动补充 Key/模型 → 保存并切换”流程。本批新增国内常用入口，默认只写入公开的供应商名称、协议、Base URL 和模型 ID，不写入任何密钥。

| 供应商          | KyStudy 协议       | 默认 Base URL                              | 默认模型                      |
| --------------- | ------------------ | ------------------------------------------ | ----------------------------- |
| 智谱 GLM        | `zhipu_chat`       | `https://open.bigmodel.cn/api/paas/v4`     | `glm-5.2`                     |
| Kimi            | `openai_chat`      | `https://api.moonshot.ai/v1`               | `kimi-k3`                     |
| MiniMax         | `openai_chat`      | `https://api.minimaxi.com/v1`              | `MiniMax-M2.7`                |
| 百度千帆        | `openai_chat`      | `https://qianfan.baidubce.com/v2`          | `ernie-4.0-turbo-8k`          |
| 豆包 / 火山方舟 | `doubao_responses` | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-lite-260215` |
| SiliconFlow     | `openai_chat`      | `https://api.siliconflow.cn/v1`            | `deepseek-ai/DeepSeek-V3`     |

## 协议边界

- `openai_chat` 复用 OpenAI Chat Completions 请求和 `/models` 模型探测；不提供 `/models` 的厂商仍可直接填写模型 ID。
- 豆包继续走 Responses API，避免把两种响应格式混用。
- 默认值仅作为起始配置，供应商侧模型升级后可在表单中更新；API Key 仍只通过 Rust 凭据桥接保存。

## 官方接口依据

- [智谱对话补全 API](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8)
- [Kimi Chat API](https://platform.kimi.ai/docs/api/chat)
- [MiniMax 对话 API](https://platform.minimaxi.com/document/%E5%AF%B9%E8%AF%9D)
- [百度千帆 OpenAI 兼容接口](https://cloud.baidu.com/doc/qianfan-docs/s/qm8qxemze)
- [火山方舟 Chat Completions API](https://api.volcengine.com/api-explorer/?action=ChatCompletions&groupName=%E5%AF%B9%E8%AF%9D%28Chat%29+API&serviceCode=ark&tab=3&tab_sdk=GO&version=2024-01-01)
- [火山方舟 Responses API](https://www.volcengine.com/docs/82379/1795150)
