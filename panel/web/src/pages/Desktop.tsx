import { useNavigate, useParams } from 'react-router-dom';

// 直接加载 KasmVNC 的 noVNC 页面（由 kclient 静态托管）。
// 反代按实例隔离：所有桌面流量走 /desktop/<id>/*，网关据 <id> 选目标容器并注入该实例凭据。
// path=desktop/<id>/websockify：让 noVNC 把 ws 连到该实例路径，网关剥前缀反代回 KasmVNC 根 /websockify。
function desktopUrl(id: string) {
  return (
    `/desktop/${id}/vnc/index.html?autoconnect=1&path=desktop/${id}/websockify&resize=remote` +
    '&reconnect=true&reconnect_delay=2000&clipboard_up=true&clipboard_down=true&clipboard_seamless=true'
  );
}

export default function Desktop() {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  if (!id) {
    nav('/', { replace: true });
    return null;
  }
  return (
    <div className="desktop-wrap">
      <iframe className="desktop-frame" src={desktopUrl(id)} title="电脑版微信" allow="clipboard-read; clipboard-write" />
      <button className="desktop-back" onClick={() => nav('/')} title="返回">
        ‹
      </button>
    </div>
  );
}
