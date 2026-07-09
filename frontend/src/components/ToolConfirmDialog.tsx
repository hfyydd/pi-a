import { useStore } from "../store/useStore";
import { ShieldAlert, Play, X } from "lucide-react";
import "./ToolConfirmDialog.css";

/**
 * 工具确认弹窗（对标 WorkBuddy permissionRequest UI）。
 *
 * WorkBuddy 的权限确认方式：
 *   - 在工具调用块内联显示确认信息
 *   - 提供「运行 / 跳过 / 拒绝」三个选项
 *   - 命令内容直接显示在确认区域
 *
 * 本组件以 overlay 弹窗方式实现，悬浮在聊天区域底部。
 */
export default function ToolConfirmDialog() {
  const { pendingConfirm, respondConfirm } = useStore();

  if (!pendingConfirm) return null;

  const { toolName, args } = pendingConfirm;

  // 提取可读描述
  const commandText = toolName === "bash"
    ? (args?.command || "")
    : toolName === "write" || toolName === "edit"
      ? `${toolName} → ${args?.path || args?.filePath || "unknown"}`
      : `${toolName}`;

  const labelMap: Record<string, string> = {
    bash: "终端命令",
    write: "写入文件",
    edit: "编辑文件",
    mouse_click: "鼠标点击",
    key_type: "键盘输入",
    memory_write: "写入记忆",
    write_docx: "生成文档",
    write_xlsx: "生成表格",
    write_pptx: "生成演示",
  };
  const label = labelMap[toolName] || toolName;

  return (
    <div className="tool-confirm-overlay">
      <div className="tool-confirm-card">
        <div className="tool-confirm-header">
          <ShieldAlert size={16} className="tool-confirm-icon" />
          <span className="tool-confirm-title">需要确认：{label}</span>
        </div>

        <div className="tool-confirm-body">
          <pre className="tool-confirm-command">{commandText}</pre>
        </div>

        <div className="tool-confirm-actions">
          <button
            className="tool-confirm-btn tool-confirm-btn--approve"
            onClick={() => respondConfirm(true)}
          >
            <Play size={13} />
            运行
          </button>
          <button
            className="tool-confirm-btn tool-confirm-btn--reject"
            onClick={() => respondConfirm(false)}
          >
            <X size={13} />
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
