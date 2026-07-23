import { useEffect, useState } from "react";
import { useStore } from "./store/useStore";
import { initTheme } from "./store/appStore";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import Composer from "./components/Composer";
import WorkspaceModal from "./components/WorkspaceModal";
import AskUserQuestionDialog from "./components/AskUserQuestionDialog";
import SettingsModal from "./components/SettingsModal";

import AutomationPanel from "./components/AutomationPanel";
import ExpertPanel from "./components/ExpertPanel";
import FloatView from "./components/FloatView";

export default function App() {
  const { sidebarCollapsed, activeCategory, loadWorkspaces, loadConversations, loadSettings } = useStore();
  const [isFloat, setIsFloat] = useState(false);

  useEffect(() => {
    const t = initTheme();
    useStore.setState({ theme: t });

    const checkHash = () => {
      setIsFloat(window.location.hash === "#float" || window.location.search.includes("float=true"));
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);

    // 加载全局设置
    loadSettings();
    // 先加载工作空间（确定 currentWorkspaceId），再加载该空间下的对话
    loadWorkspaces().then(() => loadConversations());

    return () => window.removeEventListener("hashchange", checkHash);
  }, []);

  if (isFloat) {
    return <FloatView />;
  }

  const isMac = navigator.userAgent.includes("Mac");

  return (
    <div className={isMac ? "mac-window" : ""} style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <Sidebar collapsed={sidebarCollapsed} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        {activeCategory === "automation" ? <AutomationPanel /> :
         activeCategory === "expert" ? <ExpertPanel /> : (
          <>
            <ChatArea />
            <Composer />
          </>
        )}
      </div>
      <WorkspaceModal />
      <SettingsModal />
      <AskUserQuestionDialog />
    </div>
  );
}
