# 亲宝贝家庭云相册部署说明

## 项目内容

这是一个家庭照片/视频时间线网站，包含：

- 照片和视频选择入口
- 百度网盘上传入口
- 按日期分组的媒体时间线
- 缩略图、视频标识、同步状态
- 图片/视频详情预览

当前版本提供本地预览时间线、百度网盘手动上传入口和“已手动上传”标记。浏览器不能在没有百度授权的情况下把用户选择的本地文件静默传给百度网盘页面；如果需要全自动上传，需要接入百度开放平台 OAuth 和网盘文件上传 API。

## 环境要求

- Node.js 22.13 或更高版本
- npm

## 小程序入口认证环境变量

```env
PORTAL_API_BASE=https://api.hltree.cloud/api/portal
PORTAL_SESSION_SECRET=至少32位的高强度随机字符串
```

- 用户只能通过微信小程序客服消息中的一次性链接进入。
- `portal_ticket` 会由本站服务端兑换，成功后写入 12 小时有效的签名 HttpOnly Cookie。
- `PORTAL_SESSION_SECRET` 仅配置在服务器环境中，不能提交到仓库或发送到前端。

## 百度网盘环境变量

```env
BAIDU_APP_KEY=gUDfeXpmlfBLBtBFxosTOJj4vNEm9xOY
BAIDU_SECRET_KEY=在服务器环境变量中填写
BAIDU_REDIRECT_URI=https://hltree.cloud/api/baidu/callback
BAIDU_APP_NAME=亲宝贝
BAIDU_SCOPE=basic,netdisk
```

`BAIDU_SECRET_KEY` 不能放到前端代码里，只能配置在服务端。

## 本地构建

```bash
npm ci
npm run build
```

## 生产运行

```bash
npm run start
```

## Windows 本地预览

如果 `npm run dev` 因本机 Workers 运行时问题无法启动，可以先构建后使用轻量预览：

```bash
npm run build
node scripts/local-preview.mjs
```

然后打开 `http://127.0.0.1:4173`。

## 从 GitHub 更新部署

```bash
git pull
npm ci
npm run build
pm2 restart qinbaobei
```

生产环境使用标准 Next.js Node 服务，默认由 `npm run start` 启动。

## 后续接入百度网盘自动上传

要做成“选中文件后自动保存到百度网盘”，需要准备：

- 百度开放平台应用
- 应用的 App Key、Secret Key
- OAuth 授权回调地址
- `access_token` 刷新和存储方案
- 服务端文件上传接口

准备好这些信息后，可以把当前页面里的“打开百度网盘手动上传”按钮替换为真正的授权和上传流程。

详细接口清单见 `BAIDU_NETDISK_INTEGRATION.md`。
