#!/usr/bin/env bash
set -euo pipefail
umask 077

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
service=flyreq-image-studio
repository=${FLYREQ_IMAGE_REPOSITORY:-ghcr.io/lgwtonylgw/flyreq-image-studio}
state_dir=.release
state_file="$state_dir/images"

action=${1:-status}
case "$action" in
  deploy) [[ $# -eq 2 ]] || { echo 'Usage: bash deploy-image.sh deploy IMAGE@sha256:DIGEST' >&2; exit 2; } ;;
  rollback|status) [[ $# -le 1 ]] || { echo "Usage: bash deploy-image.sh $action" >&2; exit 2; } ;;
  *) echo 'Usage: bash deploy-image.sh deploy IMAGE@sha256:DIGEST | rollback | status' >&2; exit 2 ;;
esac

mkdir -p -- "$state_dir"
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo 'Another FlyReq deployment is running.' >&2; exit 1; }

current=''
previous=''
if [[ -f "$state_file" ]]; then
  read -r current previous < "$state_file"
fi
if [[ "$action" != deploy ]]; then
  container=$(docker container ls --all --filter "name=^/${service}$" --format '{{.ID}}')
fi

if [[ "$action" == status ]]; then
  if [[ -n "$container" ]]; then
    docker container inspect --format 'Image={{.Config.Image}} Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$container"
  else
    echo 'No FlyReq container exists.'
  fi
  printf 'Last healthy image: %s\nPrevious healthy image: %s\n' "${current:-none}" "${previous:-none}"
  exit 0
fi

# 若最近一次升级未通过健康检查，优先恢复上一次健康的镜像。
target=${2:-}
if [[ "$action" == rollback ]]; then
  actual=''
  if [[ -n "$container" ]]; then
    actual=$(docker container inspect --format '{{.Config.Image}}' "$container")
  fi
  target=$previous
  if [[ "$actual" != "$current" ]]; then
    target=$current
  fi
  [[ -n "$target" ]] || { echo 'No healthy image has been recorded for rollback.' >&2; exit 1; }
fi

[[ "$target" == "${repository}@"* && "${target#*@}" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  printf 'Use a full image digest from %s.\n' "$repository" >&2
  exit 2
}

for file in docker-compose.yml .env prompts.json blacklist.json; do
  [[ -f "$file" ]] || { printf 'Missing required file: %s\n' "$file" >&2; exit 1; }
done

case "$(uname -m)" in
  x86_64) platform=linux/amd64 ;;
  aarch64|arm64) platform=linux/arm64 ;;
  *) echo 'FlyReq deployment supports amd64 and arm64 servers.' >&2; exit 1 ;;
esac

export FLYREQ_IMAGE="$target"
compose=(docker compose --env-file .env -f docker-compose.yml)
"${compose[@]}" config --quiet

# 在替换容器前完成下载。回滚优先使用服务器保存的本地镜像。
if [[ "$action" == deploy ]] || ! docker image inspect "$target" >/dev/null 2>&1; then
  docker pull --platform "$platform" "$target"
fi
image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$target")
[[ "$image_platform" == "$platform" ]] || {
  printf 'Image platform %s does not match server %s.\n' "$image_platform" "$platform" >&2
  exit 1
}

# 等待健康检查成功后原子更新状态，失败时保留两次成功部署的镜像引用。
if [[ "$target" != "$current" ]]; then
  previous=$current
fi
pending=$(mktemp "$state_dir/images.XXXXXX")
trap 'rm -f -- "$pending"' EXIT
printf '%s %s\n' "$target" "$previous" > "$pending"

if ! "${compose[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 90 "$service"; then
  echo 'Deployment did not pass the health check. Inspect the logs or run bash deploy-image.sh rollback.' >&2
  exit 1
fi
mv -f -- "$pending" "$state_file"
printf 'Healthy image: %s\n' "$target"
