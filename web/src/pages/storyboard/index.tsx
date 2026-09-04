import { Tabs } from "antd";
import { useLocation, useNavigate } from "react-router-dom";

import { useConfigStore } from "@/stores/use-config-store";
import { BrainstormAgentStudio } from "./brainstorm-agent-studio";
import { ScriptAgentPage } from "./script-agent-page";
import { StoryboardStudio } from "./storyboard-studio";

export default function StoryboardPage() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const scriptMatch = pathname.match(/\/storyboard\/script-agent(?:\/([^/]+))?\/?$/);
    const activeKey = scriptMatch ? "script-agent" : /\/storyboard\/brainstorm-agent\/?$/.test(pathname) ? "brainstorm-agent" : "storyboard";
    const projectId = scriptMatch?.[1] ? decodeURIComponent(scriptMatch[1]) : undefined;
    const visibility = useConfigStore((state) => state.publicSettings?.navigation?.storyboardItems);
    const hiddenTabKeys = new Set([visibility?.brainstormAgent === false ? "brainstorm-agent" : "", visibility?.storyboard === false ? "storyboard" : "", visibility?.scriptAgent === false ? "script-agent" : ""]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="thin-scrollbar min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="mx-auto h-full min-h-0 w-full max-w-7xl">
                    <Tabs
                        className="storyboard-tabs flex h-full min-h-0 w-full flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content]:min-w-0 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:min-h-0 [&_.ant-tabs-tabpane]:min-w-0 [&>.ant-tabs-content-holder]:flex-1 [&>.ant-tabs-content-holder]:min-h-0 [&>.ant-tabs-content-holder]:min-w-0 [&>.ant-tabs-content-holder]:w-full"
                        activeKey={activeKey}
                        onChange={(key) => navigate(key === "brainstorm-agent" ? "/storyboard/brainstorm-agent" : key === "script-agent" ? "/storyboard/script-agent" : "/storyboard")}
                        destroyOnHidden={false}
                        renderTabBar={(props, DefaultTabBar) => <DefaultTabBar {...props}>{(node) => (hiddenTabKeys.has(String(node.key)) ? <span key={node.key} hidden /> : node)}</DefaultTabBar>}
                        items={[
                            {
                                key: "brainstorm-agent",
                                label: "脑暴 Agent",
                                children: (
                                    <div className="min-h-full w-full py-4 lg:h-full lg:min-h-0">
                                        <BrainstormAgentStudio />
                                    </div>
                                ),
                            },
                            {
                                key: "storyboard",
                                label: "分镜创作室",
                                children: (
                                    <div className="grid min-h-full min-w-0 w-full grid-cols-1 gap-4 py-4 xl:h-full xl:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
                                        <StoryboardStudio />
                                    </div>
                                ),
                            },
                            {
                                key: "script-agent",
                                label: "剧本 Agent",
                                children: (
                                    <div className="min-h-full w-full py-4 lg:h-full lg:min-h-0">
                                        <ScriptAgentPage projectId={projectId} />
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </main>
        </div>
    );
}
