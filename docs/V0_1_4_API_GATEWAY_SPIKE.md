# v0.1.4 API 管理项目选型与接入决议

> 状态变更：本文是历史 LiteLLM Spike 记录，当前 1.4 计划不再把 LiteLLM 作为默认或必选网关。后续 API 管理能力以 [CC-Switch](https://github.com/farion1231/cc-switch) 的成熟 Provider 预设、凭据管理和模型映射为主要参考。

状态：历史 Spike，当前方案已转向 CC-Switch 核心能力移植（2026-08-18）。

## 1. 选型结论

1.4 API 统一接入 [LiteLLM AI Gateway](https://github.com/BerriAI/litellm)，KyStudy 不再继续增加供应商私有协议分支。

LiteLLM 是成熟的开源 AI 网关，提供 OpenAI 兼容的 `/v1/models` 和 `/v1/chat/completions` 接口，并负责多供应商路由、模型别名、虚拟 Key、预算、限流、重试和用量统计。KyStudy 只保存 LiteLLM 网关地址和虚拟 Key，供应商密钥留在网关配置中。

## 1.1 Provider 配置界面参考与边界

KyStudy 的 Provider 配置界面参考 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 的“预设供应商卡片 → 自动填充配置 → 手动补充 Key/模型 → 保存并切换”流程，但不复制其面向 Claude Code、Codex、Gemini CLI 等 Agent 工具的配置文件、代理接管、MCP、Skills、托盘和云同步能力。

1.4 首批只提供 DeepSeek、OpenAI、通义千问、OpenAI 兼容网关（LiteLLM / New API）和自定义配置五个入口；预设只包含公开的名称、官网、Base URL 和默认模型，不包含密钥。2. 预设选择后仍可修改协议、显示名称、Base URL、模型 ID 和高级限制；自定义配置会清空非敏感字段，避免把上一个预设的地址误保存到新 Provider。3. API Key 链接使用 LobeHub Icons 作为品牌图标，Key 仍只通过 KyStudy 的 Rust 凭据层写入 Windows 凭据管理器；前端不保存密钥。4. 该界面层与传输层解耦：LiteLLM 只是一个可选的 OpenAI 兼容网关，后续可在不改对话业务契约的情况下接入其他兼容网关。

LiteLLM 仓库的非 `enterprise/` 内容采用 MIT 许可；发布前仍需对实际部署版本和依赖链做许可证复核：[LICENSE](https://github.com/BerriAI/litellm/blob/main/LICENSE)。

## 2. KyStudy 接入边界

- 前端只调用 Tauri 命令，不直接请求 LiteLLM 或任何模型供应商。
- Rust 凭据层保存 LiteLLM virtual key，WebView、SQLite 普通字段、日志和错误文本不出现密钥。
- `litellm_gateway` 是唯一新增的统一远程 Provider 类型；现有 OpenAI/智谱/千问/DeepSeek 等直连类型仅保留兼容旧数据，不再扩展。
- 基础地址默认 `http://127.0.0.1:4000/v1`，远程部署必须使用 HTTPS；模型 ID 使用 LiteLLM 的 `model_name` 或 alias。
- LiteLLM 未启动、Key 无权限、模型不可用和上游错误均映射为 KyStudy 的统一错误码，不能伪装成成功响应。

## 3. LiteLLM 最小部署契约

```yaml
model_list:
  - model_name: study-default
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/UPSTREAM_API_KEY
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

启动网关后，在 KyStudy 的“模型与 API”中新增“LiteLLM AI Gateway（开源）”，填写：

```powershell
uv tool install "litellm[proxy]"
litellm --config .\config.yaml
```

1. 基础地址：`http://127.0.0.1:4000/v1`；
2. API Key：LiteLLM virtual key（不是上游供应商 Key）；
3. 模型 ID：先点击“获取模型”，选择 `model_name` 或 alias；
4. 保存后新配置会自动设为当前 Provider，再执行连接测试。

LiteLLM 的虚拟 Key、模型别名和预算机制以官方文档为准：[AI Gateway](https://docs.litellm.ai/docs/simple_proxy)、[Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys)。

## 4. 迁移与回滚

- 数据库继续使用 `provider_protocol` 保存 `litellm_gateway`，旧 `provider_type` 保持 `openai_responses` 以兼容历史约束。
- 回滚时可停用 LiteLLM Provider，重新激活既有兼容 Provider；不会删除对话、调用历史或学习数据。
- 本阶段不把 LiteLLM Python 服务打进 Tauri 安装包，避免把 Python 运行时和网关依赖强行绑定到桌面客户端；后续可提供可选的本地网关安装器。

## 5. 验收矩阵

| 场景                                | 预期                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| LiteLLM `/v1/models` 可用           | KyStudy 展示去重后的模型/alias 列表                        |
| LiteLLM `/v1/chat/completions` 可用 | 对话、题目分析和资料上下文返回完整响应                     |
| 网关未启动                          | 显示 Provider 不可用，保留重试入口                         |
| Key 无效或模型无权限                | 显示认证/拒绝错误，不保存半成品消息                        |
| 新建配置并填写 Key                  | 自动切换为当前 Provider，下一次对话直接走网关              |
| API Key 检查                        | 不出现在 WebView 网络请求、SQLite 普通字段、日志和错误文本 |
