import { useEffect, useState, useMemo } from "react";
import {
  Plus, Search, X, Trash2, Edit, Check, RefreshCw, Cpu, Puzzle, Link, Sparkles, Settings
} from "lucide-react";
import { useSkillStore, type SkillMeta, type McpServerConfig, type McpConfig } from "../store/useSkillStore";
import "./ExpertPanel.css";

// 预定义推荐和精选技能的数据与正文模板
interface TemplateSkill {
  id: string;
  name: string;
  desc: string;
  category: string;
  body: string;
}

const TEMPLATE_SKILLS: TemplateSkill[] = [
  {
    id: "neodata-finance",
    name: "NeoData金融搜索服务",
    desc: "自然语言查询股票、基金、宏观、外汇、大宗商品等金融数据",
    category: "数据分析",
    body: `# NeoData金融搜索服务
当用户询问金融数据、股票价格、外汇汇率或大宗商品走势时：
1. 使用 web_search 查询最新的金融行情和新闻。
2. 提取股票/基金的最新价、涨跌幅、成交量等关键指标。
3. 用表格形式输出整理好的金融数据，结构清晰。
4. 对数据进行简要 of 数据解读，给出支撑面或阻力面。`
  },
  {
    id: "markitdown",
    name: "MarkItDown",
    desc: "文档转 Markdown (PDF/Word/PPT/图片OCR/音频转写/网页)",
    category: "效率工具",
    body: `# MarkItDown
当用户需要将各种格式的文档（PDF、Word、PPT等）转换为 Markdown 格式时：
1. 使用 read_doc 工具读取文件。
2. 将段落、表格、列表等元素完整且结构化地转换成 Markdown 语法。
3. 保持原有的标题层级和排版格式。`
  },
  {
    id: "ashare-data",
    name: "A股全栈数据",
    desc: "A股行情、研报、资金流、公告与财报查询工具包",
    category: "数据分析",
    body: `# A股全栈数据
当用户需要查询 A 股上市公司的行情、资金流、研报或财务报表时：
1. 使用 web_search 查询最新的研报摘要和公告。
2. 结构化汇总个股最新表现（市盈率、市净率、主力资金净流入等）。
3. 生成分析报告并保存为周报/月报格式。`
  },
  {
    id: "qq-music",
    name: "QQ音乐助手",
    desc: "QQ音乐官方智能助手，支持歌曲搜索、每日推荐、AI歌单、排行榜、听歌报告",
    category: "生活服务",
    body: `# QQ音乐助手
当用户想听音乐、寻找歌曲或创建歌单时：
1. 引导用户指定歌手、风格或情绪。
2. 推荐精选歌单，提供曲目列表。
3. 给出歌曲的歌词润色建议。`
  },
  {
    id: "excel-processing",
    name: "Excel 文件处理",
    desc: "Excel 文件结构分析、公式生成与自动填充",
    category: "办公协同",
    body: `# Excel文件处理技能
当用户需要处理 Excel 文件时：
1. 用 read_doc 读取指定的 .xlsx 或 .csv 文件。
2. 分析行列数据，计算求和、平均值等常用统计量。
3. 如果需要修改，用 write_xlsx 生成新的分析结果。`
  },
  {
    id: "word-generation",
    name: "Word 文档生成",
    desc: "根据大纲自动生成结构化、专业排版的 Word 文档报告",
    category: "办公协同",
    body: `# Word文档生成技能
当用户需要撰写文档或报告时：
1. 使用 write_docx 创建结构良好的 Word 文档。
2. 包含规范的标题、子标题以及段落。
3. 适当使用项目符号或编号列表。`
  },
  {
    id: "ppt-generation",
    name: "PPT 演示文档",
    desc: "根据幻灯片主题 and 内容大纲，自动排版并生成 PPT 演示文稿",
    category: "办公协同",
    body: `# PPT生成技能
当用户需要制作幻灯片时：
1. 使用 write_pptx 依据用户提供的主题生成多页幻灯片。
2. 规划好封面页、目录页、内容页和总结页。
3. 保持文字精简，每页控制在 5 条要点以内。`
  },
  {
    id: "imap-smtp",
    name: "IMAP/SMTP邮件",
    desc: "通过 IMAP/SMTP 收发邮件，支持多账户和附件管理",
    category: "办公协同",
    body: `# 邮件收发技能
当用户需要处理电子邮件时：
1. 引导用户输入邮件主题、收件人和正文。
2. 使用 bash 执行发送脚本或模拟邮件客户端行为。
3. 整理收件箱中的未读邮件并生成摘要。`
  },
  {
    id: "qq-email",
    name: "QQ邮箱",
    desc: "QQ邮箱收发邮件（IMAP/SMTP），支持发送、收信、查看正文",
    category: "办公协同",
    body: `# QQ邮箱技能
专门针对 QQ 邮箱的收发辅助：
1. 快速读取最新的未读邮件。
2. 发送简洁的工作通知和邮件。`
  },
  {
    id: "obsidian-sync",
    name: "obsidian",
    desc: "Obsidian 笔记库连接器，支持双链、Markdown格式、标签同步",
    category: "知识与学习",
    body: `# Obsidian笔记技能
同步和编辑 Obsidian 笔记：
1. 读取 Obsidian 笔记库中的 Markdown 文件。
2. 自动补充双向链接 \`[[Note Name]]\`。
3. 格式化标签和元数据 Frontmatter。`
  },
  {
    id: "weiyun-netdisk",
    name: "腾讯微云",
    desc: "管理腾讯微云网盘文件（列表、上传、下载、删除、分享）",
    category: "效率工具",
    body: `# 腾讯微云技能
当用户想要管理微云网盘里的文件时：
1. 用 bash 列出本地待上传的微云同步目录。
2. 按照微云的文件同步规则对文件进行分类整理。`
  },
  {
    id: "tencent-survey",
    name: "腾讯问卷",
    desc: "腾讯问卷操作（创建、修改、逻辑设置、统计分析）",
    category: "生活服务",
    body: `# 腾讯问卷技能
辅助设计问卷：
1. 根据用户给出的主题，生成包含单选、多选、问答等题型的问卷大纲。
2. 整理回收的数据，生成图表式的分析报告。`
  },
  {
    id: "rumor-killer",
    name: "鹅厂辟谣助手",
    desc: "腾讯相关传闻辟谣辅助，结合内部参考与实时联网核查",
    category: "效率工具",
    body: `# 鹅厂辟谣助手技能
当用户询问关于某个传闻的真实性时：
1. 用 web_search 搜索相关新闻和辟谣通告。
2. 给出明确的辟谣结论（真/假/有待证实）。
3. 附带事实依据与权威出处。`
  },
  {
    id: "map-helper",
    name: "腾讯地图·地图助手",
    desc: "依据自然语言调用地图全套服务，辅助AI旅游攻略规划与导航",
    category: "生活服务",
    body: `# 腾讯地图助手技能
辅助规划行程：
1. 依据用户的目的地，推荐最佳路线（驾车/公交/步行）。
2. 列沿途的主要景点、美食和注意事项。`
  }
];

// 精选技能池（可换一换）
const FEATURED_POOL = [
  "weiyun-netdisk",
  "tencent-survey",
  "rumor-killer",
  "map-helper",
  "neodata-finance",
  "ashare-data",
  "markitdown",
  "qq-music"
];

// 预定义连接器/MCP数据结构
interface PresetConnector {
  id: string;
  name: string;
  desc: string;
  icon: string;
  logo?: string;
  serverConfig: McpServerConfig;
}

const PRESET_CONNECTORS: PresetConnector[] = [
  {
    id: "tdx",
    name: "通达信",
    desc: "通过通达信 MCP 查询全球股票行情数据、条件选股、研究报告、公告资讯和宏观信息。支持个股基本面分析、同行业对比和智能选股筛查。",
    icon: "📈",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-tdx"] }
  },
  {
    id: "tencent-portfolio",
    name: "腾讯自选股",
    desc: "直连腾讯自选股，实时掌握毫秒级行情与资金动态，用自然语言分析自选股数据、设置股价提醒、管理模拟交易，轻松搞定盯盘与投资决策。",
    icon: "📊",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-tencent-portfolio"] }
  },
  {
    id: "qq-email-mcp",
    name: "QQ邮箱",
    desc: "收发、搜索和整理 QQ 邮件。用自然语言读取邮件内容、汇总邮件线程、管理文件夹。",
    icon: "✉️",
    logo: "/logos/qq-email.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-qq-email"] }
  },
  {
    id: "ima-knowledge",
    name: "ima知识库",
    desc: "引用知识库资料及文件，浏览知识库详情。",
    icon: "🐼",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-ima"] }
  },
  {
    id: "lexiang",
    name: "乐享知识库",
    desc: "搜索、创建和管理乐享知识库中的文档。支持导入 Markdown、按标签整理内容、追踪团队文档的更新动态。",
    icon: "🛡️",
    logo: "/logos/lexiang.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-lexiang"] }
  },
  {
    id: "tencent-docs",
    name: "腾讯文档",
    desc: "创建、编辑和协作腾讯文档。用自然语言管理在线表格、文档和幻灯片，轻松完成内容查询、数据整理和团队协同。",
    icon: "📘",
    logo: "/logos/tencent-docs.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-tencent-docs"] }
  },
  {
    id: "tencent-meeting",
    name: "腾讯会议",
    desc: "通过命令行创建、查询和管理腾讯会议。支持快速发起会议、查看日程安排、管理参会人员。",
    icon: "📞",
    logo: "/logos/tencent-meeting.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-tencent-meeting"] }
  },
  {
    id: "wecom",
    name: "企业微信",
    desc: "企业微信10人及以下企业支持消息、文档、日程、会议、待办等MCP能力；10人以上企业仅支持创建、读取文档 and 智能表格。",
    icon: "💬",
    logo: "/logos/wecom.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-wecom"] }
  },
  {
    id: "feishu",
    name: "飞书",
    desc: "通过命令行管理飞书/Lark全产品能力：即时通讯、邮箱、日历、云文档、电子表格、多维表格 (Base)、幻灯片、看板、知识库、云空间、妙记、视频...",
    icon: "🌐",
    logo: "/logos/lark.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-feishu"] }
  },
  {
    id: "dingtalk",
    name: "钉钉",
    desc: "通过命令行管理钉钉全产品能力：AI 表格、考勤、日历、群聊与机器人、通讯录、开放平台文档、DING 消息、钉钉文档、钉钉云盘、AI 听记、邮箱、...",
    icon: "🔨",
    logo: "/logos/dingtalk.png",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-dingtalk"] }
  },
  {
    id: "tencent-survey-mcp",
    name: "腾讯问卷",
    desc: "创建、管理和分析腾讯问卷。用自然语言快速生成问卷、查看回收数据、设置题目逻辑。",
    icon: "📝",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-tencent-survey"] }
  },
  {
    id: "tapd",
    name: "TAPD",
    desc: "管理需求、缺陷、任务和迭代。查询项目进度、拆分需求、流转状态、填写工时，覆盖需求到发布的研究开发全生命周期。",
    icon: "📌",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-tapd"] }
  },
  {
    id: "cnb",
    name: "CNB",
    desc: "通过自然语言管理 CNB 平台：仓库、Issue、PR、流水线、制品库等操作。",
    icon: "🐙",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-cnb"] }
  },
  {
    id: "weiyun",
    name: "微云",
    desc: "查看、下载、删除微云文件，并且提供上传文件到微云、生成分享链接能力，帮你管理微云文件",
    icon: "☁️",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-weiyun"] }
  },
  {
    id: "fubangshou",
    name: "福帮手",
    desc: "管理福帮手服务、同步任务数据和处理日常工作流",
    icon: "🤝",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-fubangshou"] }
  },
  {
    id: "wps",
    name: "金山文档",
    desc: "创建和编辑金山文档、同步本地 Office 文档和表格数据",
    icon: "✏️",
    serverConfig: { command: "npx", args: ["-y", "mcp-server-wps"] }
  }
];

const getAvatarStyle = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [200, 220, 260, 280, 320, 340, 150, 180];
  const hue = hues[Math.abs(hash) % hues.length];
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 70%, 55%) 0%, hsl(${hue}, 75%, 45%) 100%)`,
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: "bold" as const,
    borderRadius: "50%",
    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.06)",
  };
};

export default function ExpertPanel() {
  const {
    skills, experts, loadSkills, saveSkill, deleteSkill, toggleSkill, loadExperts, startExpertChat,
    mcpConfig, mcpConnected, loadMcp, saveMcp, installPresetMcp, uninstallMcp
  } = useSkillStore();

  const [activeTab, setActiveTab] = useState<"expert" | "skill" | "connector">("skill");
  const [searchQuery, setSearchQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [selectedSubCategory, setSelectedSubCategory] = useState("全部");

  // 精选技能的索引列表
  const [featuredIds, setFeaturedIds] = useState<string[]>(FEATURED_POOL.slice(0, 4));

  // 技能表单模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [formName, setFormName] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formDisabled, setFormDisabled] = useState(false);

  // MCP模态框状态
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpSearchQuery, setMcpSearchQuery] = useState("");
  const [isEditingMcpConfig, setIsEditingMcpConfig] = useState(false);
  const [mcpConfigText, setMcpConfigText] = useState("");
  const [mcpErrorAlert, setMcpErrorAlert] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
    loadExperts();
    loadMcp();
  }, []);

  // 换一换精选技能
  const handleShuffleFeatured = () => {
    const shuffled = [...FEATURED_POOL].sort(() => 0.5 - Math.random());
    setFeaturedIds(shuffled.slice(0, 4));
  };

  // 检查技能是否已安装
  const isSkillInstalled = (templateId: string) => {
    return skills.some((s) => s.name === templateId);
  };

  // 检查技能是否已启用
  const isSkillEnabled = (templateId: string) => {
    const sk = skills.find((s) => s.name === templateId);
    return sk ? !sk.disabled : false;
  };

  // 一键安装/卸载模板技能
  const handleToggleInstallTemplate = async (tmpl: TemplateSkill) => {
    const installed = isSkillInstalled(tmpl.id);
    if (installed) {
      if (confirm(`确定卸载技能「${tmpl.name}」？`)) {
        await deleteSkill(tmpl.id);
      }
    } else {
      await saveSkill(tmpl.id, tmpl.desc, false, tmpl.body, tmpl.name);
    }
  };

  // 技能分类
  const categories = useMemo(() => {
    const list = new Set<string>();
    TEMPLATE_SKILLS.forEach((s) => list.add(s.category));
    return ["全部", ...Array.from(list)];
  }, []);

  // 过滤后的模板技能列表 (用于推荐套件)
  const filteredTemplateSkills = useMemo(() => {
    return TEMPLATE_SKILLS.filter((tmpl) => {
      const matchCat = selectedSubCategory === "全部" || tmpl.category === selectedSubCategory;
      const query = searchQuery.toLowerCase();
      const matchQuery = tmpl.name.toLowerCase().includes(query) || tmpl.desc.toLowerCase().includes(query);
      return matchCat && matchQuery;
    });
  }, [selectedSubCategory, searchQuery]);

  // 过滤后的已安装技能列表 (用于我安装的)
  const filteredInstalledSkills = useMemo(() => {
    return skills.filter((s) => {
      const query = searchQuery.toLowerCase();
      const dispName = s.displayName || s.name;
      return dispName.toLowerCase().includes(query) || s.description.toLowerCase().includes(query);
    });
  }, [skills, searchQuery]);

  // 过滤后的专家列表 (用于搜索)
  const filteredExperts = useMemo(() => {
    return experts.filter((exp) => {
      const query = searchQuery.toLowerCase();
      return exp.name.toLowerCase().includes(query) || exp.description.toLowerCase().includes(query);
    });
  }, [experts, searchQuery]);

  // 获取精选技能卡片列表
  const featuredSkills = useMemo(() => {
    return featuredIds.map((id) => TEMPLATE_SKILLS.find((s) => s.id === id)).filter(Boolean) as TemplateSkill[];
  }, [featuredIds]);

  // 打开新建技能窗口
  const handleOpenAddModal = () => {
    setModalMode("add");
    setFormName("");
    setFormDisplayName("");
    setFormDesc("");
    setFormBody(`# 新建自定义技能
当用户要求我做某事时：
1. 步骤一描述
2. 步骤二描述
`);
    setFormDisabled(false);
    setModalOpen(true);
  };

  // 打开编辑技能窗口
  const handleOpenEditModal = (sk: SkillMeta) => {
    setModalMode("edit");
    setFormName(sk.name);
    setFormDisplayName(sk.displayName || sk.name);
    setFormDesc(sk.description);
    setFormBody(sk.body);
    setFormDisabled(sk.disabled);
    setModalOpen(true);
  };

  // 保存技能表单
  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-zA-Z0-9_-]+$/.test(formName)) {
      alert("技能标识名只能包含字母、数字、下划线或连字符");
      return;
    }
    try {
      await saveSkill(formName, formDesc, formDisabled, formBody, formDisplayName);
      setModalOpen(false);
    } catch (err: any) {
      alert("保存失败: " + err.message);
    }
  };

  // ==================== MCP相关逻辑 ====================

  // 打开MCP管理模态框
  const handleOpenMcpModal = () => {
    setIsEditingMcpConfig(false);
    setMcpSearchQuery("");
    setMcpErrorAlert(null);
    setMcpModalOpen(true);
  };

  // 切换MCP配置编辑模式
  const handleToggleMcpConfigMode = () => {
    if (!isEditingMcpConfig) {
      setMcpConfigText(JSON.stringify(mcpConfig || { mcpServers: {} }, null, 2));
      setMcpErrorAlert(null);
    }
    setIsEditingMcpConfig(!isEditingMcpConfig);
  };

  // 保存MCP JSON配置文本
  const handleSaveMcpConfigText = async () => {
    try {
      const parsed = JSON.parse(mcpConfigText) as McpConfig;
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        throw new Error("配置对象中必须包含 mcpServers 属性");
      }
      const ok = await saveMcp(parsed);
      if (ok) {
        setIsEditingMcpConfig(false);
        setMcpErrorAlert(null);
      } else {
        setMcpErrorAlert("后端保存失败，请检查终端日志！");
      }
    } catch (err: any) {
      setMcpErrorAlert("JSON 解析有误: " + err.message);
    }
  };

  // 卸载MCP服务器
  const handleUninstallMcp = async (serverName: string) => {
    if (confirm(`确认卸载并删除 MCP 服务器「${serverName}」？`)) {
      await uninstallMcp(serverName);
    }
  };

  // 检查连接器是否安装在 MCP 配置中
  const isMcpInstalled = (id: string) => {
    return !!mcpConfig?.mcpServers?.[id];
  };

  // 检查连接器是否处于连接状态
  const isMcpConnected = (id: string) => {
    return mcpConnected.some((c) => c.name === id);
  };

  // 触发连接器的一键安装与卸载
  const handleToggleMcpInstall = async (tmpl: PresetConnector) => {
    const installed = isMcpInstalled(tmpl.id);
    if (installed) {
      if (confirm(`确定卸载连接器「${tmpl.name}」？这会从 mcp.json 中移除该配置。`)) {
        await uninstallMcp(tmpl.id);
      }
    } else {
      await installPresetMcp(tmpl.id, tmpl.serverConfig);
    }
  };

  // 过滤后的连接器/MCP服务器列表
  const filteredMcpServers = useMemo(() => {
    const servers = Object.entries(mcpConfig?.mcpServers || {});
    if (!mcpSearchQuery) return servers;
    const query = mcpSearchQuery.toLowerCase();
    return servers.filter(([name]) => name.toLowerCase().includes(query));
  }, [mcpConfig, mcpSearchQuery]);

  return (
    <div className="expert-panel">
      {/* ── 顶部控制栏 ── */}
      <div className="ep-header">
        <div className="ep-tabs">
          <button
            className={`ep-tab-btn ${activeTab === "expert" ? "active" : ""}`}
            onClick={() => setActiveTab("expert")}
          >
            <Cpu size={16} />
            <span>专家</span>
          </button>
          <button
            className={`ep-tab-btn ${activeTab === "skill" ? "active" : ""}`}
            onClick={() => setActiveTab("skill")}
          >
            <Puzzle size={16} />
            <span>技能</span>
          </button>
          <button
            className={`ep-tab-btn ${activeTab === "connector" ? "active" : ""}`}
            onClick={() => setActiveTab("connector")}
          >
            <Link size={16} />
            <span>连接器</span>
          </button>
        </div>

        <div className="ep-controls">
          {activeTab === "skill" && (
            <>
              <div className="ep-search-wrapper">
                <Search size={14} className="ep-search-icon" />
                <input
                  type="text"
                  placeholder="搜索技能"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ep-search-input"
                />
              </div>

              <button
                className={`ep-btn ep-btn-secondary ${installedOnly ? "active" : ""}`}
                onClick={() => {
                  setInstalledOnly(!installedOnly);
                  setSelectedSubCategory("全部");
                }}
              >
                我安装的 <span className="ep-badge">{skills.length}</span>
              </button>

              <button className="ep-btn ep-btn-primary" onClick={handleOpenAddModal}>
                <Plus size={14} />
                <span>添加技能</span>
              </button>
            </>
          )}

          {activeTab === "connector" && (
            <button className="ep-btn ep-btn-primary" onClick={handleOpenMcpModal}>
              <Plus size={14} />
              <span>自定义连接器</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 主内容区 ── */}
      <div className="ep-body scrollable">
        {/* ==================== 专家 TAB ==================== */}
        {activeTab === "expert" && (
          <div className="ep-tab-pane">
            <div className="ep-pane-title">专家库 <span className="ep-sub-title">切换专家可以为会话加载特定的系统提示词和专业技能</span></div>
            <div className="ep-grid expert-grid">
              {filteredExperts.map((exp) => (
                <div key={exp.id} className="ep-card expert-card">
                  {/* Top row: Avatar + Name/Nickname/Badge + Action */}
                  <div className="expert-card-top">
                    <div className="expert-card-left">
                      <div className="expert-avatar" style={exp.icon ? {} : getAvatarStyle(exp.id)}>
                        {exp.icon ? (
                          <img src={exp.icon} alt={exp.name} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                          exp.name ? exp.name.charAt(0) : "专"
                        )}
                      </div>
                      <div className="expert-name-group">
                        <div className="expert-name-row">
                          <span className="expert-name">{exp.name}</span>
                          {exp.badge && <span className="expert-badge-tag">{exp.badge}</span>}
                        </div>
                        {exp.nickname && <div className="expert-nickname">{exp.nickname}</div>}
                      </div>
                    </div>
                    <button
                      className="expert-action-btn"
                      onClick={() => startExpertChat(exp.id, exp.name)}
                    >
                      召唤
                    </button>
                  </div>

                  {/* Middle row: Description */}
                  <div className="expert-desc">{exp.description}</div>

                  {/* Bottom row: Tags */}
                  {exp.tags && exp.tags.length > 0 && (
                    <div className="expert-tags-row">
                      {exp.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="expert-tag-pill">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================== 技能 TAB ==================== */}
        {activeTab === "skill" && (
          <div className="ep-tab-pane animate-fade-in">
            {!installedOnly ? (
              <>
                {/* ── 精选技能 ── */}
                <div className="ep-section-header">
                  <span className="ep-section-title">精选技能</span>
                  <button className="ep-shuffle-btn" onClick={handleShuffleFeatured}>
                    <RefreshCw size={13} />
                    <span>换一换</span>
                  </button>
                </div>

                <div className="ep-grid featured-grid">
                  {featuredSkills.map((tmpl) => {
                    const installed = isSkillInstalled(tmpl.id);
                    const enabled = isSkillEnabled(tmpl.id);
                    return (
                      <div key={tmpl.id} className={`ep-card featured-card ${installed ? "installed" : ""}`}>
                        <div className="featured-card-header">
                          <div className="skill-logo">
                            <Sparkles size={18} />
                          </div>
                          <button
                            className={`install-icon-btn ${installed ? "installed" : ""}`}
                            onClick={() => handleToggleInstallTemplate(tmpl)}
                            title={installed ? "点击卸载" : "点击安装"}
                          >
                            {installed ? <Check size={14} /> : <Plus size={14} />}
                          </button>
                        </div>
                        <div className="skill-meta-info">
                          <div className="skill-title-row">
                            <span className="skill-title">{tmpl.name}</span>
                            {installed && (
                              <span className={`status-tag ${enabled ? "enabled" : "disabled"}`}>
                                {enabled ? "已启用" : "已禁用"}
                              </span>
                            )}
                          </div>
                          <div className="skill-desc">{tmpl.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── 推荐 SkillHub 套件 ── */}
                <div className="ep-section-header margin-top-lg">
                  <span className="ep-section-title">推荐 SkillHub 套件</span>
                </div>

                <div className="ep-sub-tabs">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      className={`ep-sub-tab-btn ${selectedSubCategory === cat ? "active" : ""}`}
                      onClick={() => setSelectedSubCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="ep-grid skill-hub-grid">
                  {filteredTemplateSkills.map((tmpl) => {
                    const installed = isSkillInstalled(tmpl.id);
                    const enabled = isSkillEnabled(tmpl.id);
                    return (
                      <div key={tmpl.id} className={`ep-card hub-card ${installed ? "installed" : ""}`}>
                        <div className="hub-card-top">
                          <div className="skill-title-row">
                            <span className="skill-title">{tmpl.name}</span>
                            {installed && (
                              <span className={`status-tag ${enabled ? "enabled" : "disabled"}`}>
                                {enabled ? "已启用" : "已禁用"}
                              </span>
                            )}
                          </div>
                          <button
                            className={`install-icon-btn ${installed ? "installed" : ""}`}
                            onClick={() => handleToggleInstallTemplate(tmpl)}
                            title={installed ? "点击卸载" : "点击安装"}
                          >
                            {installed ? <Check size={14} /> : <Plus size={14} />}
                          </button>
                        </div>
                        <div className="skill-desc">{tmpl.desc}</div>
                        <div className="hub-card-bottom">
                          <span className="category-tag">{tmpl.category}</span>
                        </div>
                      </div>
                    );
                  })}
                  {filteredTemplateSkills.length === 0 && (
                    <div className="ep-empty-view">暂无匹配的技能套件</div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* ── 我安装的技能管理 ── */}
                <div className="ep-section-header">
                  <span className="ep-section-title">我安装的管理控制台</span>
                </div>
                <div className="installed-list">
                  {filteredInstalledSkills.map((skillMeta) => {
                    return (
                      <div key={skillMeta.name} className={`installed-item ${skillMeta.disabled ? "disabled-item" : ""}`}>
                        <div className="installed-item-main">
                          <div className="installed-item-title-row">
                            <span className="installed-item-title">{skillMeta.displayName || skillMeta.name}</span>
                            <span className="installed-item-tag">{skillMeta.name}</span>
                            {skillMeta.builtin && <span className="builtin-tag">内置</span>}
                          </div>
                          <div className="installed-item-desc">{skillMeta.description || "无描述"}</div>
                        </div>

                        <div className="installed-item-actions">
                          {/* 启用/禁用 开关 */}
                          <label className="switch" title={skillMeta.disabled ? "已禁用，点击启用" : "已启用，点击禁用"}>
                            <input
                              type="checkbox"
                              checked={!skillMeta.disabled}
                              onChange={() => toggleSkill(skillMeta.name, !skillMeta.disabled)}
                            />
                            <span className="slider round"></span>
                          </label>

                          {/* 编辑 */}
                          <button
                            className="ep-action-icon-btn"
                            title="编辑技能"
                            onClick={() => handleOpenEditModal(skillMeta)}
                          >
                            <Edit size={14} />
                          </button>

                          {/* 删除 (仅非内置技能) */}
                          {!skillMeta.builtin ? (
                            <button
                              className="ep-action-icon-btn ep-action-danger"
                              title="删除技能"
                              onClick={() => {
                                if (confirm(`确认删除技能「${skillMeta.displayName || skillMeta.name}」？`)) {
                                  deleteSkill(skillMeta.name);
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : (
                            <div style={{ width: 32 }} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredInstalledSkills.length === 0 && (
                    <div className="ep-empty-view">暂无安装的自定义技能，请从上面安装或点击添加。</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ==================== 连接器 (MCP) TAB ==================== */}
        {activeTab === "connector" && (
          <div className="ep-tab-pane animate-fade-in">
            <div className="ep-pane-title">连接器中心 <span className="ep-sub-title">连接器基于 MCP 服务器提供底层服务，安装后即可将工具集载入 AI 脑区协同工作</span></div>
            <div className="ep-grid connector-grid">
              {PRESET_CONNECTORS.map((c) => {
                const installed = isMcpInstalled(c.id);
                const connected = isMcpConnected(c.id);
                return (
                  <div key={c.id} className={`ep-card connector-card ${installed ? "enabled" : ""}`}>
                    <div className="connector-card-top">
                      <div className="connector-icon">
                        {c.logo ? (
                          <img src={c.logo} alt={c.name} style={{ width: "26px", height: "26px", objectFit: "contain" }} />
                        ) : (
                          c.icon
                        )}
                      </div>
                      <button
                        className={`install-icon-btn ${installed ? "installed" : ""}`}
                        onClick={() => handleToggleMcpInstall(c)}
                        title={installed ? "点击卸载连接器" : "点击配置连接器"}
                      >
                        {installed ? <Check size={14} /> : <Plus size={14} />}
                      </button>
                    </div>
                    <div className="connector-name">{c.name}</div>
                    <div className="connector-desc">{c.desc}</div>
                    <div className="connector-card-actions">
                      <div className="connector-status-badge">
                        {installed ? (
                          <span className={`mcp-status-tag ${connected ? "connected" : "disconnected"}`}>
                            {connected ? "已连接" : "已激活/连接中"}
                          </span>
                        ) : (
                          <span className="mcp-status-tag uninstalled">未连接</span>
                        )}
                      </div>
                      <button
                        className="connector-setting-btn"
                        onClick={handleOpenMcpModal}
                      >
                        <Settings size={12} />
                        <span>服务配置</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── 技能编辑/添加模态框 ── */}
      {modalOpen && (
        <div className="ep-modal-overlay">
          <div className="ep-modal">
            <div className="ep-modal-header">
              <h3>{modalMode === "add" ? "添加自定义技能" : "编辑技能配置"}</h3>
              <button className="ep-modal-close" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveForm} className="ep-modal-body">
              <div className="form-group">
                <label>技能唯一标识 (Alphanumeric/唯一)</label>
                <input
                  type="text"
                  required
                  disabled={modalMode === "edit"}
                  placeholder="例如: translation-helper"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>显示名称 (用户界面中显示)</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 智能翻译专家"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>描述</label>
                <input
                  type="text"
                  placeholder="简述该技能在什么情况下会被激活..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group flex-fill-grow">
                <label>技能提示词正文 (Markdown 格式)</label>
                <textarea
                  required
                  placeholder="# 技能指令要求\n在此写下技能的详细运作规范..."
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  className="form-control textarea-body"
                />
              </div>

              <div className="ep-modal-footer">
                <button
                  type="button"
                  className="ep-btn ep-btn-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="ep-btn ep-btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MCP 服务管理模态框 ── */}
      {mcpModalOpen && (
        <div className="ep-modal-overlay">
          <div className="ep-modal mcp-modal">
            <div className="ep-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Puzzle size={18} />
                <h3>MCP 服务管理</h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="ep-btn ep-btn-secondary"
                  onClick={handleToggleMcpConfigMode}
                >
                  配置 MCP
                </button>
                <button className="ep-modal-close" onClick={() => setMcpModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {isEditingMcpConfig ? (
              /* JSON 代码编辑视图 */
              <div className="ep-modal-body mcp-editor-body">
                <div className="mcp-config-path-label">
                  配置文件路径: <span>~/.pi-a/mcp.json</span>
                </div>
                {mcpErrorAlert && (
                  <div className="mcp-error-alert">
                    {mcpErrorAlert}
                  </div>
                )}
                <textarea
                  className="form-control mcp-json-textarea"
                  value={mcpConfigText}
                  onChange={(e) => {
                    setMcpConfigText(e.target.value);
                    setMcpErrorAlert(null);
                  }}
                  placeholder="请输入 JSON 配置..."
                />
                <div className="ep-modal-footer">
                  <button
                    className="ep-btn ep-btn-secondary"
                    onClick={() => setIsEditingMcpConfig(false)}
                  >
                    取消
                  </button>
                  <button className="ep-btn ep-btn-primary" onClick={handleSaveMcpConfigText}>
                    保存
                  </button>
                </div>
              </div>
            ) : (
              /* 服务器列表视图 */
              <div className="ep-modal-body mcp-list-body">
                <div className="mcp-list-controls">
                  <div className="ep-search-wrapper" style={{ flex: 1 }}>
                    <Search size={14} className="ep-search-icon" />
                    <input
                      type="text"
                      placeholder="搜索服务器..."
                      value={mcpSearchQuery}
                      onChange={(e) => setMcpSearchQuery(e.target.value)}
                      className="ep-search-input"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <button
                    className="ep-btn ep-btn-secondary"
                    onClick={() => window.open("https://github.com/modelcontextprotocol/servers")}
                  >
                    MCP Hub
                  </button>
                </div>

                <div className="mcp-servers-list scrollable">
                  {filteredMcpServers.length > 0 ? (
                    filteredMcpServers.map(([name, srv]) => {
                      const connInfo = mcpConnected.find((c) => c.name === name);
                      const isConnected = !!connInfo;
                      const tools = connInfo?.tools || [];
                      return (
                        <div key={name} className="mcp-server-item">
                          <div className="mcp-server-item-header">
                            <div className="mcp-server-info-title">
                              <span className={`mcp-status-indicator ${isConnected ? "connected" : "disconnected"}`} />
                              <span className="mcp-server-name">{name}</span>
                              <span className="mcp-server-type-tag">
                                {srv.command ? "stdio" : "sse"}
                              </span>
                            </div>
                            <button
                              className="ep-action-icon-btn ep-action-danger"
                              onClick={() => handleUninstallMcp(name)}
                              title="删除服务器"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          <div className="mcp-server-details">
                            {srv.command && (
                              <div className="mcp-detail-row">
                                <span className="mcp-detail-label">命令:</span>
                                <span className="mcp-detail-value">{srv.command} {srv.args?.join(" ")}</span>
                              </div>
                            )}
                            {srv.url && (
                              <div className="mcp-detail-row">
                                <span className="mcp-detail-label">URL:</span>
                                <span className="mcp-detail-value">{srv.url}</span>
                              </div>
                            )}
                            <div className="mcp-detail-row">
                              <span className="mcp-detail-label">工具数量:</span>
                              <span className="mcp-detail-value">{tools.length} 个</span>
                            </div>
                            {tools.length > 0 && (
                              <div className="mcp-tools-badges">
                                {tools.map((t) => (
                                  <span key={t} className="mcp-tool-badge" title={t}>
                                    {t.replace(`mcp_${name}_`, "")}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="mcp-empty-state">
                      <Puzzle size={40} className="mcp-empty-icon" />
                      <div className="mcp-empty-text">暂无 MCP 服务器</div>
                      <div className="mcp-empty-subtext">点击右上角配置按钮或连接器卡片一键添加</div>
                      <button className="ep-btn ep-btn-primary" onClick={() => handleToggleMcpConfigMode()}>
                        配置
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
