import { hostname } from 'node:os';
import Docker from 'dockerode';
import type { Instance } from './store.js';

const WECHAT_IMAGE = process.env.WOC_WECHAT_IMAGE || 'ghcr.io/gloridust/wechat-on-cloud:latest';
const PUID = process.env.PUID || '1000';
const PGID = process.env.PGID || '1000';
const TZ = process.env.TZ || 'Asia/Shanghai';
const SHM_SIZE = 1024 * 1024 * 1024; // 1gb

const docker = new Docker(); // 默认连 /var/run/docker.sock

// 面板自身所在的 docker 网络名；新实例都 attach 到它，便于按容器名互访。
let networkName: string | null = process.env.WOC_DOCKER_NETWORK || null;

export type RuntimeState = 'running' | 'stopped' | 'missing';

// 启动时探测面板自身网络（容器内 hostname = 容器短 id）。失败不致命：
// 退回 WOC_DOCKER_NETWORK 或 null（null 时用 docker 默认 bridge，靠 IP 不靠名字会有问题，故尽量探测成功）。
export async function ensureNetwork(): Promise<string | null> {
  if (networkName) return networkName;
  try {
    const self = docker.getContainer(hostname());
    const info = await self.inspect();
    const nets = Object.keys(info.NetworkSettings?.Networks || {}).filter((n) => n !== 'none' && n !== 'host');
    if (nets.length > 0) networkName = nets[0];
  } catch (e: any) {
    console.warn('[docker] 无法探测面板网络（本地开发或缺少 docker.sock 时正常）:', e?.message || e);
  }
  return networkName;
}

function envList(inst: Instance): string[] {
  return [
    `PUID=${PUID}`,
    `PGID=${PGID}`,
    `TZ=${TZ}`,
    `CUSTOM_USER=${inst.kasmUser}`,
    `PASSWORD=${inst.kasmPassword}`,
  ];
}

// 确保微信镜像在本地存在；缺失则从 GHCR 拉取（首次新建实例时镜像通常还没拉过）。
async function ensureImage(): Promise<void> {
  try {
    await docker.getImage(WECHAT_IMAGE).inspect();
    return;
  } catch {
    /* 本地没有，下面拉取 */
  }
  await pullImage();
}

// 创建并启动一个微信实例容器。若同名容器已存在则先移除（仅容器，不动卷）。
export async function runInstance(inst: Instance): Promise<void> {
  const net = await ensureNetwork();
  await ensureImage();
  try {
    const existing = docker.getContainer(inst.containerName);
    await existing.inspect();
    await existing.remove({ force: true });
  } catch {
    /* 不存在，正常 */
  }
  const container = await docker.createContainer({
    name: inst.containerName,
    Image: WECHAT_IMAGE,
    Hostname: inst.containerName,
    Env: envList(inst),
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      Binds: [`${inst.volumeName}:/config`],
      NetworkMode: net || undefined,
      SecurityOpt: ['seccomp=unconfined'],
      ShmSize: SHM_SIZE,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });
  await container.start();
}

// 确保实例容器在运行：缺失则按需创建（不会重建已有卷），停止则启动。
export async function ensureRunning(inst: Instance): Promise<void> {
  try {
    const c = docker.getContainer(inst.containerName);
    const info = await c.inspect();
    if (!info.State?.Running) await c.start();
  } catch {
    await runInstance(inst);
  }
}

export async function removeInstance(inst: Instance, purgeVolume: boolean): Promise<void> {
  try {
    const c = docker.getContainer(inst.containerName);
    await c.remove({ force: true });
  } catch {
    /* 容器可能已不存在 */
  }
  if (purgeVolume) {
    try {
      await docker.getVolume(inst.volumeName).remove({ force: true } as any);
    } catch {
      /* 卷可能不存在 */
    }
  }
}

export async function instanceRuntime(inst: Instance): Promise<RuntimeState> {
  try {
    const info = await docker.getContainer(inst.containerName).inspect();
    return info.State?.Running ? 'running' : 'stopped';
  } catch {
    return 'missing';
  }
}

// 在实例容器内执行命令，返回 stdout（demux 后只取标准输出）。
async function execCapture(inst: Instance, cmd: string[]): Promise<string> {
  const c = docker.getContainer(inst.containerName);
  const exec = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false, User: 'abc' });
  const stream = await exec.start({ hijack: true, stdin: false });
  return await new Promise<string>((resolve, reject) => {
    let out = '';
    let err = '';
    const stdout = { write: (b: Buffer) => { out += b.toString('utf8'); } } as any;
    const stderr = { write: (b: Buffer) => { err += b.toString('utf8'); } } as any;
    docker.modem.demuxStream(stream, stdout, stderr);
    stream.on('end', () => resolve(out || err));
    stream.on('error', reject);
  });
}

// 触发下载/安装（detached，立即返回，后台下载）。
export async function triggerWechat(inst: Instance, cmd: 'install' | 'update'): Promise<void> {
  const c = docker.getContainer(inst.containerName);
  const exec = await c.exec({
    Cmd: ['/woc/wechat-ctl.sh', cmd === 'update' ? 'update' : 'install'],
    AttachStdout: false,
    AttachStderr: false,
    User: 'abc',
  });
  await exec.start({ Detach: true });
}

export interface WechatStatus {
  phase: string;
  percent: number;
  installed: boolean;
  version: string;
  message: string;
  updatedAt: number;
}

const DEFAULT_STATUS: WechatStatus = { phase: 'idle', percent: 0, installed: false, version: '', message: '未安装', updatedAt: 0 };

export async function wechatStatus(inst: Instance): Promise<WechatStatus> {
  try {
    const raw = await execCapture(inst, ['/woc/wechat-ctl.sh', 'status']);
    const json = JSON.parse(raw.trim());
    return { ...DEFAULT_STATUS, ...json };
  } catch {
    return DEFAULT_STATUS;
  }
}

// 拉取微信镜像（首次部署/更新镜像用）。返回拉取日志的最后状态。
export async function pullImage(onProgress?: (line: any) => void): Promise<void> {
  return await new Promise((resolve, reject) => {
    docker.pull(WECHAT_IMAGE, (err: any, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(
        stream,
        (e: any) => (e ? reject(e) : resolve()),
        (ev: any) => onProgress?.(ev),
      );
    });
  });
}

// 实例容器名（供反代构造 target）。
export function instanceTarget(inst: Instance): string {
  return `http://${inst.containerName}:3000`;
}

export { WECHAT_IMAGE };
