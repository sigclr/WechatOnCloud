#!/bin/bash
# 微信下载/解压控制脚本。由面板经 docker exec 触发（不再用共享卷/守护进程）：
#   install / update   下载官方 deb、dpkg-deb -x 解压到 /config/wechat、原子替换、pkill 让 autostart 用新版重启
#   status             输出当前状态 JSON（面板轮询用）
# 用 docker exec --user abc 调用，文件归属与微信运行用户一致。
set -u

STATE_DIR="${WOC_STATE_DIR:-/config/.woc-state}"
STATUS_FILE="$STATE_DIR/status.json"

INSTALL_DIR="/config/wechat"            # dpkg-deb -x 解压根；二进制在 opt/wechat/wechat
WORK_DIR="/config/.woc-dl"              # 下载/解压临时区（同卷，便于原子 mv）
VERSION_FILE="$INSTALL_DIR/.woc-version"

CDN_MAIN="${WECHAT_CDN:-https://dldir1v6.qq.com/weixin/Universal/Linux}"
CDN_FALLBACK="${WECHAT_CDN_FALLBACK:-https://dldir1.qq.com/weixin/Universal/Linux}"
UA="Mozilla/5.0"

wechat_bin() { echo "$INSTALL_DIR/opt/wechat/wechat"; }
is_installed() { [ -x "$(wechat_bin)" ]; }
cur_version() { [ -f "$VERSION_FILE" ] && cat "$VERSION_FILE" || echo ""; }

deb_filename() {
  case "$(dpkg --print-architecture 2>/dev/null)" in
    amd64) echo "WeChatLinux_x86_64.deb" ;;
    arm64) echo "WeChatLinux_arm64.deb" ;;
    *) echo "" ;;
  esac
}

# write_status <phase> <percent> <message>
# phase: idle|downloading|extracting|installing|done|error
write_status() {
  local phase="$1" percent="$2" message="$3"
  local installed=false version
  is_installed && installed=true
  version="$(cur_version)"
  mkdir -p "$STATE_DIR"
  cat > "$STATUS_FILE.tmp" <<EOF
{"phase":"$phase","percent":$percent,"installed":$installed,"version":"$version","message":"$message","updatedAt":$(date +%s)}
EOF
  mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
}

print_status() {
  if [ -f "$STATUS_FILE" ]; then
    cat "$STATUS_FILE"
  elif is_installed; then
    echo "{\"phase\":\"done\",\"percent\":100,\"installed\":true,\"version\":\"$(cur_version)\",\"message\":\"已安装\",\"updatedAt\":$(date +%s)}"
  else
    echo "{\"phase\":\"idle\",\"percent\":0,\"installed\":false,\"version\":\"\",\"message\":\"未安装\",\"updatedAt\":$(date +%s)}"
  fi
}

do_install() {
  local file url tmp pid total cur pct rc=1
  file="$(deb_filename)"
  if [ -z "$file" ]; then
    write_status error 0 "不支持的架构：微信仅提供 x86_64 / arm64"
    return
  fi

  rm -rf "$WORK_DIR"
  mkdir -p "$WORK_DIR"
  tmp="$WORK_DIR/wechat.deb"

  # 取总大小用于进度（HEAD 可能失败，失败则进度走不确定值 -1）
  for base in "$CDN_MAIN" "$CDN_FALLBACK"; do
    total="$(curl -fsSLI -A "$UA" "$base/$file" 2>/dev/null | tr -d '\r' \
            | awk 'tolower($1)=="content-length:"{v=$2} END{print v}')"
    [ -n "${total:-}" ] && url="$base/$file" && break
  done
  : "${total:=0}" "${url:=$CDN_MAIN/$file}"

  write_status downloading 0 "正在下载微信安装包"
  # 后台下载 + 轮询已下字节算百分比（下载占 0~90）
  for base in "$CDN_MAIN" "$CDN_FALLBACK"; do
    curl -fSL --retry 3 -A "$UA" -o "$tmp" "$base/$file" & pid=$!
    while kill -0 "$pid" 2>/dev/null; do
      if [ "${total:-0}" -gt 0 ] 2>/dev/null; then
        cur="$(stat -c%s "$tmp" 2>/dev/null || echo 0)"
        pct=$(( cur * 90 / total ))
        [ "$pct" -gt 90 ] && pct=90
        write_status downloading "$pct" "正在下载微信安装包"
      else
        write_status downloading -1 "正在下载微信安装包"
      fi
      sleep 1
    done
    wait "$pid"; rc=$?
    [ "$rc" -eq 0 ] && break
    write_status downloading -1 "主线路失败，尝试备用线路"
  done
  if [ "$rc" -ne 0 ]; then
    write_status error 0 "下载失败，请检查网络后重试"
    rm -rf "$WORK_DIR"; return
  fi

  write_status extracting 92 "正在解压安装"
  local newroot="$WORK_DIR/new"
  rm -rf "$newroot"; mkdir -p "$newroot"
  if ! dpkg-deb -x "$tmp" "$newroot" 2>/dev/null; then
    write_status error 0 "解压失败，安装包可能损坏"
    rm -rf "$WORK_DIR"; return
  fi
  local ver; ver="$(dpkg-deb -f "$tmp" Version 2>/dev/null || echo "")"

  if [ ! -x "$newroot/opt/wechat/wechat" ]; then
    write_status error 0 "解压后未找到微信可执行文件"
    rm -rf "$WORK_DIR"; return
  fi

  write_status installing 96 "正在安装"
  # 原子替换：先挪走旧版再就位新版，最后清理
  rm -rf "$INSTALL_DIR.old"
  [ -e "$INSTALL_DIR" ] && mv "$INSTALL_DIR" "$INSTALL_DIR.old"
  mv "$newroot" "$INSTALL_DIR"
  echo "$ver" > "$VERSION_FILE"
  rm -rf "$INSTALL_DIR.old" "$WORK_DIR"

  write_status done 100 "安装完成"
  # 让 autostart 循环用新版本重启微信（若正在运行）
  pkill -f "$INSTALL_DIR/opt/wechat/wechat" 2>/dev/null || true
}

case "${1:-status}" in
  status)
    print_status
    ;;
  install|update)
    do_install
    ;;
  *)
    echo "用法: $0 {install|update|status}" >&2; exit 1 ;;
esac
