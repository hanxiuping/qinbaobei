# 百度网盘接入接口清单

## 需要你提供的信息

接入真实上传和读取前，请准备：

- 百度网盘开放平台应用的 `App Key`，也就是 OAuth `client_id`
- 百度网盘开放平台应用的 `Secret Key`，也就是 OAuth `client_secret`
- 应用名称，决定默认上传目录：`/apps/应用名称/`
- OAuth 回调地址，例如：`https://你的域名/api/baidu/callback`
- 已开通的权限范围，至少需要 `basic,netdisk`
- 是否已经开通网盘上传权限

不要把 `Secret Key` 直接放进前端页面。它只能放在服务端环境变量里。

## 当前已配置

```env
BAIDU_APP_KEY=gUDfeXpmlfBLBtBFxosTOJj4vNEm9xOY
BAIDU_REDIRECT_URI=https://hltree.cloud/api/baidu/callback
BAIDU_APP_NAME=亲宝贝
BAIDU_SCOPE=basic,netdisk
```

还缺：

```env
BAIDU_SECRET_KEY=你的 Secret Key
```

## 如何确认权限

最直接的确认方式是用网站实际走一遍授权和接口：

1. 把网站部署到 `https://hltree.cloud`，并配好 `BAIDU_SECRET_KEY`。
2. 确认百度开放平台后台的 OAuth 回调地址也是 `https://hltree.cloud/api/baidu/callback`。
3. 点击网站里的“绑定百度网盘”。
4. 如果百度授权页正常出现，并展示 `basic,netdisk` 相关授权，说明 scope 写法可用。
5. 授权成功回到网站后，点击“读取网盘相册”。
6. 如果能读取 `/apps/亲宝贝` 目录，说明 `basic,netdisk` 读取权限可用。
7. 后续接上传时，再调用 `precreate` 接口；如果返回权限类错误，再去百度开放平台后台申请/确认上传权限。

本地 `http://127.0.0.1:4173` 可以看页面和接口状态，但不能完成你当前这个线上回调地址的 OAuth 闭环。

在百度开放平台后台，也可以进入应用详情查看“权限管理”“产品服务”“接口权限”一类入口，确认网盘相关权限是否已开通。不同后台版本的入口名称可能略有变化，以实际控制台为准。

## 授权接口

### 1. 引导用户授权

```text
GET https://openapi.baidu.com/oauth/2.0/authorize
```

关键参数：

- `response_type=code`
- `client_id=你的 App Key`
- `redirect_uri=你的回调地址`
- `scope=basic,netdisk`
- `state=随机值，用于防跨站请求`

### 2. code 换 access_token

```text
GET https://openapi.baidu.com/oauth/2.0/token
```

关键参数：

- `grant_type=authorization_code`
- `code=授权回调拿到的 code`
- `client_id=你的 App Key`
- `client_secret=你的 Secret Key`
- `redirect_uri=必须和授权时一致`

返回中需要保存：

- `access_token`
- `refresh_token`
- `expires_in`
- `scope`

## 读取接口

### 1. 获取用户信息

```text
GET https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo
```

用途：显示当前绑定的百度账号、头像、会员状态、用户 UK。

### 2. 获取网盘容量

```text
GET https://pan.baidu.com/api/quota
```

用途：显示总容量、已用容量、剩余容量。

### 3. 读取目录文件列表

```text
GET https://pan.baidu.com/rest/2.0/xpan/file?method=list
```

常用参数：

- `dir=/apps/应用名称`
- `order=time`
- `desc=1`
- `start=0`
- `limit=100`
- `web=1`，返回缩略图信息

用途：把百度网盘中的照片和视频读取出来，显示到网站时间线。

### 4. 获取文件详情和下载链接

```text
GET https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas
```

常用参数：

- `fsids=[文件 fs_id 数组]`
- `dlink=1`
- `extra=1`

用途：点击缩略图后拿文件详情、缩略图、下载链接或播放地址。

## 上传接口

百度网盘上传通常是三步：

### 1. 预创建

```text
POST https://pan.baidu.com/rest/2.0/xpan/file?method=precreate
```

Body 常用字段：

- `path=/apps/应用名称/文件名`
- `size=文件大小`
- `isdir=0`
- `autoinit=1`
- `block_list=[文件分片 MD5 数组]`

返回：

- `uploadid`
- `block_list`，需要实际上传的分片序号
- `return_type=2` 时表示秒传成功

### 2. 上传分片

```text
POST https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?method=upload
```

Query 常用参数：

- `type=tmpfile`
- `path=/apps/应用名称/文件名`
- `uploadid=预创建返回的 uploadid`
- `partseq=分片序号`

Body：

- `multipart/form-data`，包含当前分片文件内容

### 3. 创建文件

```text
POST https://pan.baidu.com/rest/2.0/xpan/file?method=create
```

Body 常用字段：

- `path=/apps/应用名称/文件名`
- `size=文件大小`
- `isdir=0`
- `uploadid=预创建返回的 uploadid`
- `block_list=[分片上传返回的 MD5 数组]`
- `rtype=3`，重名时自动重命名

## 网站接入计划

拿到你的应用信息后，建议按这个顺序接：

1. 新增服务端环境变量：`BAIDU_APP_KEY`、`BAIDU_SECRET_KEY`、`BAIDU_REDIRECT_URI`、`BAIDU_APP_NAME`
2. 新增“绑定百度网盘”按钮，跳转 OAuth 授权页
3. 新增回调接口，用 code 换 token 并保存
4. 新增“读取网盘相册”接口，调用 `xpan/file?method=list`
5. 新增“自动上传”接口，完成 precreate、slice upload、create 三步
6. 前端时间线改为读取真实网盘文件，同时保留本地预览上传进度
