import { Tabs } from "antd";

import { ScriptAgentStudio } from "./script-agent-studio";
import { StoryboardStudio } from "./storyboard-studio";

export default function StoryboardPage() {
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
            <Tabs
                className="flex min-h-0 flex-1 flex-col"
                defaultActiveKey="storyboard"
                destroyOnHidden={false}
                items={[
                    {
                        key: "storyboard",
                        label: "分镜创作室",
                        children: (
                            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                                <StoryboardStudio />
                            </main>
                        ),
                    },
                    {
                        key: "script-agent",
                        label: "剧本 Agent",
                        forceRender: true,
                        children: (
                            <div className="h-full min-h-0 overflow-y-auto p-3">
                                <ScriptAgentStudio />
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
