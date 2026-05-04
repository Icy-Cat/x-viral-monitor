# Chrome Web Store - 隐私权 (Privacy)

> 编辑页面: https://chrome.google.com/webstore/devconsole/ea0eccb4-2164-4994-a688-53acfdb73acc/dkplofpecmjmbhgjgleeflcnfgfkdfpd/edit/privacy

## 单一用途说明

```
Display real-time impression velocity (views per hour) as color-coded inline badges on tweets in the X (Twitter) timeline, helping users identify trending and viral posts at a glance.
```

## 权限说明

### 需请求 storage 的理由

```
The extension uses chrome.storage.sync to store two user-configurable numbers: the "trending" velocity threshold and the "viral" velocity threshold. These settings let users customize when tweet badges change color (e.g., from green to orange). No personal data, browsing history, or tweet content is stored. Only these two numeric preferences are saved.
```

### 需请求主机权限的理由

```
The extension needs host permissions for x.com and pro.x.com to inject content scripts that: (1) intercept the page's existing GraphQL API responses to read tweet metrics (view counts, likes, retweets), and (2) render velocity badges directly on tweet elements in the DOM. The extension does NOT make any additional network requests — it only reads data that the page already loads.
```

## 远程代码

- **是否使用远程代码**: 否

## 数据使用声明 - 收集的数据类型

以下数据类型均**未勾选**（不收集）：

- [ ] 个人身份信息（例如：姓名、邮寄地址、电子邮件地址、年龄或身份证号码）
- [ ] 健康信息（例如：心率数据、医疗记录、症状、诊断或手术）
- [ ] 财务和付款信息（例如：交易、信用卡卡号、信用评级、财务报表或付款记录）
- [ ] 身份验证信息（例如：密码、凭证、安全问题或个人识别码 PIN）
- [ ] 个人通讯（例如：电子邮件、短信或聊天消息）
- [ ] 位置（例如：区域、IP 地址、GPS 坐标或用户设备附近事物的相关信息）
- [ ] 网络记录（用户访问过的网页及相关数据）
- [ ] 用户活动（例如：网络监控、点击、鼠标指针位置、滚屏或击键操作记录）
- [ ] 网站内容（例如：文字、图片、声音、视频或超链接）

## 数据使用声明 - 合规承诺

以下三项均**已勾选**：

- [x] 我不会出于已获批准的用途之外的用途向第三方出售或传输用户数据
- [x] 我不会为实现与我的产品的单一用途无关的目的而使用或转移用户数据
- [x] 我不会为确定信用度或实现贷款而使用或转移用户数据

## 隐私权政策网址

```
(空 - 需要填写)
```
