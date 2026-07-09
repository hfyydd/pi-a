import { useState, useEffect } from "react";
import { useStore } from "../store/useStore";
import { X, Trash2, Pencil, Check } from "lucide-react";
import { WorkspaceIcon, WORKSPACE_ICON_CHOICES } from "./WorkspaceIcon";

const ICON_CHOICES = WORKSPACE_ICON_CHOICES;

export default function WorkspaceModal() {
  const {
    showWorkspaceManager, setShowWorkspaceManager,
    workspaces, composerWorkspaceId, setComposerWorkspaceId,
    _pendingDirPath,
    createWorkspace, updateWorkspace, deleteWorkspace,
  } = useStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", dirPath: "", icon: "folder" });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    if (showWorkspaceManager) {
      // 如果有「打开本地文件夹」传来的路径，预填表单并进入新建模式
      if (_pendingDirPath) {
        setEditingId(null);
        setForm({ name: _pendingDirPath.name, dirPath: _pendingDirPath.path, icon: "folder" });
        useStore.setState({ _pendingDirPath: null });
      } else {
        setEditingId(null);
        setConfirmDel(null);
        setForm({ name: "", dirPath: "", icon: "folder" });
      }
    }
  }, [showWorkspaceManager]);

  if (!showWorkspaceManager) return null;

  const startCreate = () => {
    setEditingId(null);
    setConfirmDel(null);
    setForm({ name: "", dirPath: "", icon: "folder" });
  };
  const startEdit = (ws: any) => {
    setEditingId(ws.id);
    setForm({ name: ws.name, dirPath: ws.dirPath || "", icon: ws.icon || "folder" });
    setConfirmDel(null);
  };
  const save = async () => {
    const name = form.name.trim();
    if (!name) return;
    if (editingId) {
      await updateWorkspace(editingId, { name, dirPath: form.dirPath, icon: form.icon });
    } else {
      await createWorkspace(name, form.dirPath, form.icon);
    }
    setEditingId(null);
    setForm({ name: "", dirPath: "", icon: "folder" });
  };
  const doDelete = async (id: string) => {
    await deleteWorkspace(id);
    setConfirmDel(null);
  };

  return (
    <div className="modal-overlay" onMouseDown={() => setShowWorkspaceManager(false)}>
      <div className="modal-panel ws-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">工作空间</span>
          <button className="modal-close" onClick={() => setShowWorkspaceManager(false)}><X size={16} /></button>
        </div>

        <div className="ws-modal-body">
          {/* 列表：已有空间 */}
          <div className="ws-list">
            {workspaces.length === 0 && (
              <div className="ws-empty-hint">还没有工作空间，创建一个吧</div>
            )}
            {workspaces.map((w) => (
              <div key={w.id} className={`ws-row ${w.id === composerWorkspaceId ? "active" : ""}`}>
                <button className="ws-row-main" onClick={() => { setComposerWorkspaceId(w.id); }}>
                  {/* 目录图标 + 名 + 路径 */}
                  <span className="ws-row-icon"><WorkspaceIcon name={w.icon} /></span>
                  <span className="ws-row-text">
                    <span className="ws-row-name">{w.name}</span>
                    <span className="ws-row-dir">{w.dirPath || "未关联目录"}</span>
                  </span>
                  {w.id === composerWorkspaceId && <Check size={14} className="ws-row-check" />}
                </button>
                <div className="ws-row-actions">
                  {confirmDel === w.id ? (
                    <span className="ws-confirm">
                      删除？<button className="ws-confirm-yes" onClick={() => doDelete(w.id)}>确认</button>
                      <button className="ws-confirm-no" onClick={() => setConfirmDel(null)}>取消</button>
                    </span>
                  ) : (
                    <>
                      <button className="ws-icon-btn" title="编辑" onClick={() => startEdit(w)}><Pencil size={13} /></button>
                      <button className="ws-icon-btn danger" title="删除" onClick={() => setConfirmDel(w.id)}><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 编辑 / 新建表单（以目录为核心） */}
          <div className="ws-form">
            <div className="ws-form-title">{editingId ? "编辑空间" : "新建工作空间"}</div>
            
            {/* 名称 — 可自动从目录名推导 */}
            <label className="ws-field">
              <span>名称</span>
              <input
                className="ws-input" value={form.name}
                placeholder="如：pi-a、ragflow"
                autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") save(); }}
              />
            </label>

            {/* 关联目录 — 核心字段 */}
            <label className="ws-field">
              <span>关联目录</span>
              <input
                className="ws-input" value={form.dirPath}
                placeholder="如：/Users/hanfeng/Desktop/pi-a"
                onChange={(e) => setForm({ ...form, dirPath: e.target.value })}
              />
            </label>

            {/* 图标 */}
            <div className="ws-field">
              <span>图标</span>
              <div className="ws-icon-grid">
                {ICON_CHOICES.map((ic) => (
                  <button
                    key={ic}
                    className={`ws-icon-pick ${form.icon === ic ? "active" : ""}`}
                    onClick={() => setForm({ ...form, icon: ic })}
                  ><WorkspaceIcon name={ic} /></button>
                ))}
              </div>
            </div>

            <div className="ws-form-actions">
              {editingId && <button className="btn-ghost" onClick={startCreate}>新建</button>}
              <button className="btn-primary" onClick={save}>{editingId ? "保存" : "创建空间"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
