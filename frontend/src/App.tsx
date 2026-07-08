import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { initTheme } from "./store/appStore";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import Composer from "./components/Composer";

export default function App() {
  const { sidebarCollapsed, loadConversations } = useStore();

  useEffect(() => {
    const t = initTheme();
    useStore.setState({ theme: t });
    loadConversations();
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {!sidebarCollapsed && <Sidebar />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        <ChatArea />
        <Composer />
      </div>
    </div>
  );
}
