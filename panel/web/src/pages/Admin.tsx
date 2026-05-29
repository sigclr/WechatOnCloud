import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type PanelUser, type InstanceWithStatus } from '../api';

export default function Admin() {
  const nav = useNavigate();
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [instances, setInstances] = useState<InstanceWithStatus[]>([]);
  const [err, setErr] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingInst, setCreatingInst] = useState(false);
  const [assignInst, setAssignInst] = useState<InstanceWithStatus | null>(null); // 给实例选账户
  const [assignUser, setAssignUser] = useState<PanelUser | null>(null); // 给账户选实例

  const subs = users.filter((u) => u.role !== 'admin');

  const load = async () => {
    try {
      const [{ users }, { instances }] = await Promise.all([api.listUsers(), api.listInstances()]);
      setUsers(users);
      setInstances(instances);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const instName = (id: string) => instances.find((i) => i.id === id)?.name || id;
  const usersForInstance = (id: string) => subs.filter((u) => u.allowedInstances.includes(id));

  const toggle = async (u: PanelUser) => {
    await api.setDisabled(u.id, !u.disabled).catch((e) => alert(e.message));
    load();
  };
  const reset = async (u: PanelUser) => {
    const pw = prompt(`为 ${u.username} 设置新密码（至少 6 位）`);
    if (!pw) return;
    try {
      await api.resetUser(u.id, pw);
      alert('已重置');
    } catch (e: any) {
      alert(e.message);
    }
  };
  const removeUser = async (u: PanelUser) => {
    if (!confirm(`确定删除子账号 ${u.username}？`)) return;
    await api.deleteUser(u.id).catch((e) => alert(e.message));
    load();
  };
  const removeInst = async (inst: InstanceWithStatus) => {
    if (!confirm(`删除实例「${inst.name}」？容器会被移除，但聊天记录（数据卷）会保留。`)) return;
    let purge = false;
    if (confirm('是否同时永久删除该实例的聊天记录（数据卷）？此操作不可恢复。\n\n确定=连数据一起删，取消=仅删容器保留数据')) {
      purge = true;
    }
    await api.deleteInstance(inst.id, purge).catch((e) => alert(e.message));
    load();
  };

  return (
    <div className="page">
      <header className="topbar">
        <button className="btn-text" onClick={() => nav('/')}>
          ‹ 返回
        </button>
        <span className="topbar-title">管理</span>
        <span style={{ width: 48 }} />
      </header>

      <main className="content">
        {err && <div className="error">{err}</div>}

        <div className="section-row">
          <span className="section-title">微信实例</span>
          <button className="btn-text" onClick={() => setCreatingInst(true)}>
            + 新建实例
          </button>
        </div>
        <div className="list">
          {instances.length === 0 && <div className="muted small" style={{ padding: '14px 16px' }}>暂无实例</div>}
          {instances.map((inst) => (
            <div key={inst.id} className="user-row">
              <div className="user-main">
                <span className="user-name">{inst.name}</span>
                <span className="muted small">可访问账户 {usersForInstance(inst.id).length} 人</span>
              </div>
              <div className="user-actions">
                <button className="btn-text" onClick={() => setAssignInst(inst)}>
                  分配账户
                </button>
                <button className="btn-text danger" onClick={() => removeInst(inst)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="section-row" style={{ marginTop: 22 }}>
          <span className="section-title">子账号</span>
          <button className="btn-text" onClick={() => setCreatingUser(true)}>
            + 新建子账号
          </button>
        </div>
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="user-row">
              <div className="user-main">
                <span className="user-name">
                  {u.username}
                  {u.role === 'admin' && <span className="tag">管理员</span>}
                  {u.disabled && <span className="tag tag-off">已禁用</span>}
                </span>
                {u.role === 'admin' ? (
                  <span className="muted small">可访问全部实例</span>
                ) : u.allowedInstances.length > 0 ? (
                  <span className="chip-row">
                    {u.allowedInstances.map((id) => (
                      <span key={id} className="chip chip-static">
                        {instName(id)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted small">未分配实例</span>
                )}
              </div>
              {u.role !== 'admin' && (
                <div className="user-actions">
                  <button className="btn-text" onClick={() => setAssignUser(u)}>
                    可访问实例
                  </button>
                  <button className="btn-text" onClick={() => toggle(u)}>
                    {u.disabled ? '启用' : '禁用'}
                  </button>
                  <button className="btn-text" onClick={() => reset(u)}>
                    重置密码
                  </button>
                  <button className="btn-text danger" onClick={() => removeUser(u)}>
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {creatingUser && (
        <CreateUser
          instances={instances}
          onClose={() => setCreatingUser(false)}
          onDone={() => {
            setCreatingUser(false);
            load();
          }}
        />
      )}
      {creatingInst && (
        <CreateInstance
          subs={subs}
          onClose={() => setCreatingInst(false)}
          onDone={() => {
            setCreatingInst(false);
            load();
          }}
        />
      )}
      {assignInst && (
        <AssignUsers
          inst={assignInst}
          subs={subs}
          onClose={() => setAssignInst(null)}
          onDone={() => {
            setAssignInst(null);
            load();
          }}
        />
      )}
      {assignUser && (
        <AssignInstances
          user={assignUser}
          instances={instances}
          onClose={() => setAssignUser(null)}
          onDone={() => {
            setAssignUser(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// 通用 chip 多选
function ChipMultiSelect({
  options,
  selected,
  onToggle,
  empty,
}: {
  options: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  empty: string;
}) {
  if (options.length === 0) return <div className="muted small">{empty}</div>;
  return (
    <div className="chip-row chip-row-pick">
      {options.map((o) => (
        <button
          type="button"
          key={o.id}
          className={'chip chip-toggle' + (selected.has(o.id) ? ' on' : '')}
          onClick={() => onToggle(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CreateUser({ instances, onClose, onDone }: { instances: InstanceWithStatus[]; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.createUser(username.trim(), password, [...sel]);
      onDone();
    } catch (e: any) {
      setErr(e.message || '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>新建子账号</h2>
        <input
          className="input"
          placeholder="用户名（3-20 位字母/数字/下划线）"
          autoCapitalize="off"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input className="input" type="password" placeholder="初始密码（至少 6 位）" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="field-label">可访问的微信实例</div>
        <ChipMultiSelect
          options={instances.map((i) => ({ id: i.id, label: i.name }))}
          selected={sel}
          onToggle={(id) => setSel((s) => toggleSet(s, id))}
          empty="暂无实例，可稍后在账户里分配"
        />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy || !username || !password}>
            创建
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateInstance({ subs, onClose, onDone }: { subs: PanelUser[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.createInstance(name.trim(), [...sel]);
      onDone();
    } catch (e: any) {
      setErr(e.message || '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>新建微信实例</h2>
        <input className="input" placeholder="实例名称（如：我的微信 / 公司号）" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="field-label">允许访问的子账号（管理员默认可访问全部）</div>
        <ChipMultiSelect
          options={subs.map((u) => ({ id: u.id, label: u.username }))}
          selected={sel}
          onToggle={(id) => setSel((s) => toggleSet(s, id))}
          empty="暂无子账号"
        />
        {err && <div className="error">{err}</div>}
        <div className="muted small" style={{ marginTop: 4 }}>创建后会拉起一个新的微信容器，进入后扫码登录。</div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            创建
          </button>
        </div>
      </form>
    </div>
  );
}

function AssignUsers({
  inst,
  subs,
  onClose,
  onDone,
}: {
  inst: InstanceWithStatus;
  subs: PanelUser[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(subs.filter((u) => u.allowedInstances.includes(inst.id)).map((u) => u.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.setInstanceUsers(inst.id, [...sel]);
      onDone();
    } catch (e: any) {
      setErr(e.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h2>「{inst.name}」可访问账户</h2>
        <ChipMultiSelect
          options={subs.map((u) => ({ id: u.id, label: u.username }))}
          selected={sel}
          onToggle={(id) => setSel((s) => toggleSet(s, id))}
          empty="暂无子账号"
        />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignInstances({
  user,
  instances,
  onClose,
  onDone,
}: {
  user: PanelUser;
  instances: InstanceWithStatus[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(user.allowedInstances));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.setUserInstances(user.id, [...sel]);
      onDone();
    } catch (e: any) {
      setErr(e.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h2>{user.username} 可访问实例</h2>
        <ChipMultiSelect
          options={instances.map((i) => ({ id: i.id, label: i.name }))}
          selected={sel}
          onToggle={(id) => setSel((s) => toggleSet(s, id))}
          empty="暂无实例"
        />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function toggleSet(s: Set<string>, id: string): Set<string> {
  const next = new Set(s);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
