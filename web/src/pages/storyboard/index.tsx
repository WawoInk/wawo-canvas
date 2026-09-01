import { Tabs } from "antd";
import { useLocation, useNavigate } from "react-router-dom";

import { BrainstormAgentStudio } from "./brainstorm-agent-studio";
import { ScriptAgentPage } from "./script-agent-page";
import { StoryboardStudio } from "./storyboard-studio";

export default function StoryboardPage() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const scriptMatch = pathname.match(/\/storyboard\/script-agent(?:\/([^/]+))?\/?$/);
    const activeKey = scriptMatch ? "script-agent" : /\/storyboard\/brainstorm-agent\/?$/.test(pathname) ? "brainstorm-agent" : "storyboard";
    const projectId = scriptMatch?.[1] ? decodeURIComponent(scriptMatch[1]) : undefined;

    return (
        <div className="thin-scrollbar h-full overflow-y-auto bg-background text-foreground">
            <Tabs
                className="mx-auto flex h-full min-h-0 w-full max-w-[2400px] flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content]:min-w-0 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:min-h-0 [&_.ant-tabs-tabpane]:min-w-0 [&_.ant-tabs-nav-wrap]:mx-auto [&_.ant-tabs-nav-wrap]:w-full [&_.ant-tabs-nav-wrap]:max-w-7xl [&_.ant-tabs-nav-wrap]:px-6 [&>.ant-tabs-content-holder]:mx-auto [&>.ant-tabs-content-holder]:flex-1 [&>.ant-tabs-content-holder]:min-h-0 [&>.ant-tabs-content-holder]:min-w-0 [&>.ant-tabs-content-holder]:w-full [&>.ant-tabs-content-holder]:max-w-7xl [&>.ant-tabs-content-holder]:px-4 sm:[&>.ant-tabs-content-holder]:px-6"
                activeKey={activeKey}
                onChange={(key) => navigate(key === "brainstorm-agent" ? "/storyboard/brainstorm-agent" : key === "script-agent" ? "/storyboard/script-agent" : "/storyboard")}
                destroyOnHidden={false}
                items={[
                    {
                        key: "brainstorm-agent",
                        label: "脑暴 Agent",
                        children: (
                            <div className="mx-auto min-h-full w-full py-4 lg:h-full lg:min-h-0">
                                <BrainstormAgentStudio />
                            </div>
                        ),
                    },
                    {
                        key: "storyboard",
                        label: "分镜创作室",
                        children: (
                            <main className="mx-auto grid min-h-full min-w-0 w-full grid-cols-1 gap-4 py-4 xl:h-full xl:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
                                <StoryboardStudio />
                            </main>
                        ),
                    },
                    {
                        key: "script-agent",
                        label: "剧本 Agent",
                        children: (
                            <div className="mx-auto min-h-full w-full py-4 lg:h-full lg:min-h-0">
                                <ScriptAgentPage projectId={projectId} />
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
