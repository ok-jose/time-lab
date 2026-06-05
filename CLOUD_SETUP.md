# 云开发部署文档

本小程序内置 4 个云函数：OCR 识别、条码查询、每日提醒、订阅消息推送。
本地代码已写好，按下面 3 步填好配置就能跑通。

---

## 第 1 步：开通云开发（5 分钟）

1. 打开 **微信开发者工具**，导入本项目
2. 点击工具栏 **「云开发」** 按钮
3. 用微信扫码 → 创建新环境
   - 环境名称：`time-lab`（随便起）
   - 付费方式：选「按量付费」（免费额度够个人用很久）
4. 创建完成后，在 **「设置 → 环境设置」** 复制 **环境 ID**（形如 `time-lab-xxxxxx`）
5. 打开 `utils/cloudConfig.js`，把 `envId` 替换成你刚复制的值：

```js
module.exports = {
  envId: 'time-lab-xxxxxx',  // ← 替换这里
  subscriptionTemplateId: '__REPLACE_WITH_YOUR_TEMPLATE_ID__'
};
```

---

## 第 2 步：上传云函数（3 分钟）

回到微信开发者工具：

1. 右键 `cloudfunctions/ocr` → **「上传并部署：云端安装依赖（不上传 node_modules）」**
2. 同样操作部署：`barcodeLookup` / `dailyReminder` / `sendSubscription`
3. 部署完成会看到云函数列表里出现 4 个函数

> ⚠️ 第一次部署会自动 `npm install`，需要 1-2 分钟。

---

## 第 3 步：配置 OCR 密钥（OCR 必需，2 分钟）

OCR 云函数调用腾讯云通用文字识别 API，需要密钥：

1. 进入 [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) → 访问管理 → API 密钥管理
2. 点击「新建密钥」→ 复制 **SecretId** 和 **SecretKey**
3. 回到微信开发者工具 → 云开发控制台 → **「设置 → 环境变量」**
4. 添加两个变量：
   - `TENCENT_SECRET_ID` = 你的 SecretId
   - `TENCENT_SECRET_KEY` = 你的 SecretKey
5. **重新部署一次 `ocr` 云函数**（环境变量在重新部署后生效）

OCR 每月有 1000 次免费额度，个人用绰绰有余。

---

## 第 4 步：申请订阅消息模板（每日提醒必需，10 分钟）

`dailyReminder` 云函数会通过 `sendSubscription` 给用户发过期提醒推送，需要先申请模板：

1. 登录 [微信公众平台](https://mp.weixin.qq.com) → 订阅消息 → 公共模板库
2. 搜索「**物品过期提醒**」或类似关键词
3. 申请一个模板，至少包含这几个字段（用于 `sendSubscription/index.js`）：
   - `thing1` 物品名称
   - `number2` 数量
   - `date3` 过期日期
   - `thing4` 备注
4. 申请通过后，复制 **模板 ID**
5. 打开 `utils/cloudConfig.js` 填上：

```js
subscriptionTemplateId: '你的模板ID'  // ← 替换这里
```

> ⚠️ 一次申请只能给一个 AppID 用，所以本地测试时用的是 `wx0c021c78cc083b37`（见 project.config.json）的 AppID。

---

## 第 5 步：创建数据库集合（每日提醒必需，1 分钟）

`dailyReminder` 会读 `subscriptions` 集合：

1. 云开发控制台 → 数据库 → 创建集合 `subscriptions`
2. 权限设置 → **「仅创建者可读写」**（重要：保证用户只能看自己的订阅记录）

`sendSubscription` 读 `items` 集合发推送（如果你想把物品数据也上云，可以迁移；但当前版本是本地存储，云函数读不到你本地的物品）。

> 当前架构下，**`dailyReminder` 暂时只会推送静态演示内容**，因为物品数据在用户本地，云端拿不到。要真正推送自己物品的过期提醒，需要先把物品数据也同步到云端（属于下一阶段功能）。

---

## 第 6 步：配置定时触发器（每日提醒必需）

`cloudfunctions/dailyReminder/config.json` 已经写好：

```json
{
  "triggers": [
    {
      "name": "dailyReminderTrigger",
      "type": "timer",
      "config": "0 0 8 * * * *"
    }
  ]
}
```

意思是每天 8:00:00 触发。**首次部署时不会自动生效**，需要在云开发控制台手动启用：

1. 云开发控制台 → 云函数 → `dailyReminder` → 函数配置
2. 看到「定时触发器」一栏，点击启用

> 或者用 CLI：`tcb fn trigger create dailyReminder -e <envId> --trigger-name dailyReminderTrigger --type timer --config "0 0 8 * * * *"`

---

## 验证清单

按顺序完成后，应该全部 ✓：

- [ ] `utils/cloudConfig.js` 里 `envId` 已替换
- [ ] `utils/cloudConfig.js` 里 `subscriptionTemplateId` 已替换
- [ ] 4 个云函数已部署到云端
- [ ] 腾讯云 API 密钥已配在云函数环境变量
- [ ] `subscriptions` 数据库集合已创建，权限「仅创建者可读写」
- [ ] 微信公众平台申请了订阅消息模板并填了 ID
- [ ] `dailyReminder` 的定时触发器已启用

完成后在小程序里：

1. 进入「添加」页 → 选 OCR 模式 → 拍一张产品标签
2. 应该看到「识别到的字段」卡片显示解析出的日期
3. 一键填入表单，检查是否填对
4. 进入「设置」→ 开启过期提醒
5. 会弹出订阅消息授权，点同意
6. 到云开发控制台 → 云函数 → `dailyReminder` → 日志，应该看到每天 8:00 有执行记录

---

## 没开通云开发也能用的部分

- 首页、添加、详情、设置的基本功能
- 手动输入模式
- 拍照记录
- 本地存储的物品数据
- 导入导出 CSV

只是 OCR 自动识别 / 条码产地查询 / 订阅消息推送 这 3 个需要云端。

---

## 排错速查

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| `wx.cloud is not a function` | 微信开发者工具基础库版本 < 2.2.3 | 检查 `project.config.json` 的 `libVersion`，建议 ≥ 3.0 |
| OCR 返回「未配置 OCR 密钥」 | 云函数环境变量没设 | 重新设 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`，再部署一次 |
| 订阅消息 `errcode: 40037` | templateId 错 | 确认微信公众平台模板管理里复制的 ID 正确 |
| 订阅消息 `errcode: 43101` | 用户拒绝授权 | 正常，提示用户重试 |
| `dailyReminder` 没触发 | 定时触发器没启用 | 云开发控制台 → dailyReminder → 函数配置 → 启用触发器 |
| `subscriptions` collection 没权限 | 权限设置成「仅创建者」以外的选项 | 改成「仅创建者可读写」 |

---

## 完整配置后的架构

```
用户小程序
   ↓ wx.cloud.callFunction
   ↓
云函数层
   ├── ocr           (腾讯云 OCR API)
   ├── barcodeLookup (本地条码库，可换第三方 API)
   ├── dailyReminder (定时器触发，扫订阅推消息)
   └── sendSubscription (实际调 subscribeMessage.send)
   ↓
云数据库
   └── subscriptions (用户授权记录)
   ↓
微信服务器
   └── 推送订阅消息到用户微信
```

物品数据本身仍在用户本地 `wx.storage`，不强制上云。下一阶段如果要做"换手机数据不丢"才需要把 `items` 也上云。
