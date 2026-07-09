import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { initTheme } from "./store/appStore";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import Composer from "./components/Composer";
import WorkspaceModal from "./components/WorkspaceModal";
import ToolConfirmDialog from "./components/ToolConfirmDialog";

export default function App() {
  const { sidebarCollapsed, loadWorkspaces, loadConversations } = useStore();

  useEffect(() => {
    const t = initTheme();
    useStore.setState({ theme: t });
    // 先加载工作空间（确定 currentWorkspaceId），再加载该空间下的对话
    loadWorkspaces().then(() => loadConversations());
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {!sidebarCollapsed && <Sidebar />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        <ChatArea />
        <Composer />
      </div>
      <WorkspaceModal />
      <ToolConfirmDialog />
    </div>
  );
}
