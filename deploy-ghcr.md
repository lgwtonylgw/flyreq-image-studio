# GitHub Actions 构建与服务器部署

## 1. 在 GitHub 构建镜像

把源码和 `.github/workflows/publish-ghcr.yml` 推送到 GitHub。首次使用时，工作流文件需要存在于仓库默认分支。进入 **Actions → Build FlyReq Image Studio image for server → Run workflow**：

- `source_ref` 填写要部署的分支、标签或提交 SHA，默认 `master`。
- 在服务器执行 `uname -m`。`x86_64` 选择 `amd64`，`aarch64` 选择 `arm64`。

构建成功后，在该次运行的 **Summary** 复制整条 `bash deploy-image.sh deploy 'ghcr.io/…@sha256:…'` 命令。工作流用仓库内置的 `GITHUB_TOKEN` 推送镜像，发布地址由 GitHub 仓库名生成。每次部署使用本次构建的 digest。

## 2. 首次准备服务器

使用 Bash、Docker Compose v2.24.4 或更高版本以及 `flock`（Ubuntu/Debian 的 `util-linux` 包）。检查 `sudo ss -ltnp 'sport = :3002'` 的结果，确认宿主机端口可用。使用同一个具有 Docker 权限的 Linux 用户拉取并部署镜像。

创建 `/data/flyreq-image-studio`，从当前仓库上传以下文件。已有生产配置时保留服务器上的版本。

| 仓库文件 | 服务器部署目录内的路径 |
| --- | --- |
| `docker-compose.yml` | `docker-compose.yml` |
| `deploy-image.sh` | `deploy-image.sh` |
| `backend/.env.example` | `.env` |
| `backend/prompts.json` | `prompts.json` |
| `backend/blacklist.json` | `blacklist.json` |
| `scripts/flyreq-nginx.conf.template` | `scripts/flyreq-nginx.conf.template` |

```bash
cd /data/flyreq-image-studio
chmod 600 .env
mkdir -p data logs
```

应用配置写在 `.env`，容器固定监听 `3001`。宿主机默认绑定 `127.0.0.1:3002`，需要换端口时在 `.env` 设置 `FLYREQ_HOST_PORT`，并同步更新 Nginx 的上游端口。部署脚本按本次传入的 digest 给 Compose 设置 `FLYREQ_IMAGE`。

画布默认品牌为 Token AI Gate，模型 API 根地址为 `https://api.tokenaigate.com`，密钥入口为 `https://tokenaigate.com/keys`。镜像会识别旧部署模板中的原始品牌和默认端点。已有 `.env` 可以继续使用，自定义的渠道和已绑定密钥的浏览器模型会保留，用户可在设置里为本站模型填写自己的 API Key。

如果 GHCR 镜像包是私有的，使用有该包访问权及 `read:packages` 权限的 classic PAT 登录。下面命令通过交互提示读取令牌。

```bash
read -rsp 'GHCR token: ' flyreq_ghcr_token
printf '\n'
printf '%s' "$flyreq_ghcr_token" | docker login ghcr.io -u lgwtonylgw --password-stdin
unset flyreq_ghcr_token
```

SQLite、图片和视频保存在 `data/`，日志保存在 `logs/`。如果从已有的旧容器迁移，并且它曾把视频写到容器内的默认目录，在替换旧容器之前把旧文件复制到持久化目录：

```bash
mkdir -p data/flyreq-videos
docker cp flyreq-image-studio:/app/backend/flyreq-videos/. ./data/flyreq-videos/
```

## 3. 部署与回滚

进入 `/data/flyreq-image-studio`，执行 Actions Summary 里的完整命令。脚本在更新前完成下载及架构检查，等待容器通过健康检查后记录该镜像。部署完成后检查状态和页面：

```bash
bash deploy-image.sh status
curl -fsS -o /dev/null http://127.0.0.1:3002/api/flyreq/config
curl -fsS -o /dev/null http://127.0.0.1:3002/
```

后续升级重复构建和部署。需要恢复时运行 `bash deploy-image.sh rollback`。如果最近一次升级失败，脚本恢复上一次健康镜像。如果当前运行的是最近一次成功部署的镜像，脚本切回上一版健康镜像。镜像记录写在 `.release/images`，随部署目录保留。回滚仅切换应用镜像。升级前备份 `data/`，回滚前确认旧版程序兼容当前数据。

## 4. 配置 Nginx 和 HTTPS

沿用 `pay.tokenaigate.com` 和 `usdt.tokenaigate.com` 的部署方式，为 `studio.tokenaigate.com` 建立独立的宿主机 Nginx 站点。在 Cloudflare 的 `tokenaigate.com` 区域新增 `A` 记录，名称填 `studio`，地址填画布服务器公网 IPv4，代理状态使用橙云（Proxied），SSL/TLS 使用 Full (strict)。采用 Certbot 的 HTTP 验证时，公网 80 端口须可访问。若 Cloudflare 代理影响验证，可在签发期间将 `studio` 切到灰云，确认源站 HTTPS 正常后恢复橙云。

在 `/etc/nginx/sites-available/` 下保存站点配置，通过 `/etc/nginx/sites-enabled/` 的软链接启用。先运行 `sudo nginx -T 2>&1 | grep -nF 'studio.tokenaigate.com'` 检查该域名。若已加载 `studio` 的站点，继续使用现有站点文件，避免加载两个同名站点。下面命令适用于首次配置，需要 `envsubst`（Ubuntu/Debian 的 `gettext-base` 包）和 Certbot 的 Nginx 插件。模板支持画布 WebSocket，并从可信 Cloudflare 网段读取真实访客 IP。Cloudflare 更新网段后重新生成信任列表并重载 Nginx。

```bash
(
  set -e
  cd /data/flyreq-image-studio
  export FLYREQ_DOMAIN=studio.tokenaigate.com
  export FLYREQ_HOST_PORT=3002
  site="/etc/nginx/sites-available/$FLYREQ_DOMAIN"
  enabled="/etc/nginx/sites-enabled/$FLYREQ_DOMAIN"
  if [ -e "$site" ] || [ -L "$site" ] || [ -e "$enabled" ] || [ -L "$enabled" ]; then
    printf '站点配置或链接已存在，请检查 %s 和 %s\n' "$site" "$enabled" >&2
    exit 1
  fi

  curl -fsS https://www.cloudflare.com/ips-v4 -o cloudflare-v4.txt
  curl -fsS https://www.cloudflare.com/ips-v6 -o cloudflare-v6.txt
  awk 'BEGIN { print "real_ip_header CF-Connecting-IP;" } NF { print "set_real_ip_from " $1 ";" }' \
    cloudflare-v4.txt cloudflare-v6.txt > flyreq-cloudflare-realip.conf
  sudo install -m 644 flyreq-cloudflare-realip.conf /etc/nginx/flyreq-cloudflare-realip.conf

  envsubst '${FLYREQ_DOMAIN} ${FLYREQ_HOST_PORT}' < scripts/flyreq-nginx.conf.template > flyreq-image-studio.conf
  sudo install -m 644 flyreq-image-studio.conf "$site"
  sudo ln -s "$site" "$enabled"
  sudo nginx -t
  sudo systemctl reload nginx
  sudo certbot --nginx -d "$FLYREQ_DOMAIN"
)
```

签发后从服务器验证源站，再验证公网域名：

```bash
curl -fsS --resolve studio.tokenaigate.com:443:127.0.0.1 \
  -o /dev/null -w 'Origin HTTP %{http_code}\n' \
  https://studio.tokenaigate.com/api/flyreq/config
curl -fsS -o /dev/null -w 'Public HTTP %{http_code}\n' \
  https://studio.tokenaigate.com/api/flyreq/config
```

打开 `https://studio.tokenaigate.com/#canvas`，确认直接进入画布。生成任务时检查浏览器网络面板的 `/api/flyreq/ws` 是否返回 `101 Switching Protocols`。通过一次参考图上传验证请求体限制和图片生成链路。New API 的侧栏使用同一地址，改域名时同步更新 New API 容器的 `INFINITE_CANVAS_URL`。
