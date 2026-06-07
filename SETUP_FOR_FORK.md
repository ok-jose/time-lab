# Fork 后如何运行

如果你 fork 了本项目，需要做几步配置才能在本地跑起来。

## 1. 初始化项目配置

```bash
cp project.config.example.json project.config.json
```

然后编辑 `project.config.json`，把：

```json
"appid": "__REPLACE_WITH_YOUR_WECHAT_APPID__"
```

改成你自己的微信小程序 AppID。

> ⚠️ **AppID 不是密钥**，它是公开标识符，会出现在所有小程序网络请求里。
> 真正需要保密的是 **AppSecret**（位于 `project.private.config.json`，已在 .gitignore 里）。

> 不知道 AppID？登录 https://mp.weixin.qq.com → 开发管理 → 开发设置 → 复制 AppID(小程序ID)

## 2. 初始化云开发配置

编辑 `utils/cloudConfig.js`，填三个值：

| 字段 | 说明 | 在哪找 |
|------|------|--------|
| `envId` | 微信云开发环境 ID | 微信开发者工具 → 云开发 → 设置 → 环境设置 |
| `subscriptionTemplateId` | 订阅消息模板 ID | 微信公众平台 → 订阅消息 → 我的模板 |

详见 [CLOUD_SETUP.md](./CLOUD_SETUP.md)。

## 3. 在微信开发者工具里打开

1. 打开微信开发者工具
2. 导入项目 → 选择本仓库根目录
3. 填入你的 AppID（应该已经自动从 `project.config.json` 读到了）
4. 点击编译

## 4. 上传云函数

按 [CLOUD_SETUP.md](./CLOUD_SETUP.md) 第 2 步操作，4 个云函数都要上传。

## 不需要你改的部分

- `app.js` / `app.json` / `app.wxss` —— 全局配置，所有人共用
- `pages/*` —— 页面代码，所有人共用
- `utils/util.js` —— 工具函数，不含环境相关配置
- `images/*` —— tab icon 等静态资源

## 隐私层级总结

| 文件 | 是否进 git | 谁应该填 |
|------|----------|---------|
| `project.config.json` | ✅ 是 | 你（用你的 AppID） |
| `project.private.config.json` | ❌ 否 | 你（用你的 AppSecret） |
| `project.config.example.json` | ✅ 是 | 模板，不用动 |
| `utils/cloudConfig.js` | ✅ 是 | 你（用你的 envId / templateId） |
| 云函数环境变量 | ❌ 否（云开发控制台） | 你（用你的腾讯云密钥） |

如果只想跑起来不接云端功能，`utils/cloudConfig.js` 用占位符也行——所有云相关调用会自动降级到手动输入。
